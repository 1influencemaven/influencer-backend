import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type {
  CustomField,
  EmailTemplate,
  Prisma,
} from '../generated/prisma/client';
import { InfluencerAccessService } from '../influencers/access/influencer-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateTemplateDto,
  PreviewTemplateDto,
  QueryTemplatesDto,
  UpdateTemplateDto,
  ValidateTemplateDto,
} from './dto/templates.dto';
import {
  buildCatalog,
  compileForSaleshandy,
  htmlToPlainText,
  isEmptyBody,
  resolveTemplate,
  sanitizeTemplateHtml,
  validateVariables,
  type ProspectData,
} from './template-variables';

export const TEMPLATE_ERROR_CODES = {
  NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  ARCHIVED_READONLY: 'TEMPLATE_ARCHIVED_READONLY',
  EMPTY_BODY: 'TEMPLATE_EMPTY_BODY',
  NO_CHANGES: 'TEMPLATE_NO_CHANGES',
  IN_ACTIVE_OUTREACH: 'TEMPLATE_IN_ACTIVE_OUTREACH',
  PREVIEW_INPUT: 'TEMPLATE_PREVIEW_INPUT',
  PROSPECT_MISMATCH: 'PROSPECT_INFLUENCER_MISMATCH',
} as const;

const influencerSelect = {
  name: true,
  instagram: true,
  tiktok: true,
  youtube: true,
  countries: true,
  language: true,
  niche: true,
  subNiche: true,
  niches: true,
  followers: true,
  engagement: true,
  email: true,
  outgoingEmail: true,
  mediaKitUrl: true,
} satisfies Prisma.InfluencerSelect;

type TemplateWithRefs = EmailTemplate & {
  influencer?: { name: string } | null;
  createdBy?: { name: string } | null;
  updatedBy?: { name: string } | null;
  fieldReferences?: Array<{
    variableKey: string;
    locations: string[];
    customField: { id: string; label: string; isActive: boolean };
  }>;
};

export function toTemplateDto(t: TemplateWithRefs) {
  return {
    id: t.id,
    influencerId: t.influencerId,
    influencerName: t.influencer?.name ?? null,
    name: t.name,
    subject: t.subject,
    preHeader: t.preHeader,
    bodyHtml: t.bodyHtml,
    bodyText: t.bodyText,
    status: t.status,
    validationIssues: t.validationIssues,
    influencerVariables: t.influencerVariables,
    fieldReferences: (t.fieldReferences ?? []).map((r) => ({
      fieldId: r.customField.id,
      key: r.variableKey,
      label: r.customField.label,
      isActive: r.customField.isActive,
      locations: r.locations,
    })),
    createdBy: t.createdBy?.name ?? null,
    updatedBy: t.updatedBy?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

const detailInclude = {
  influencer: { select: { name: true } },
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
  fieldReferences: {
    include: {
      customField: { select: { id: true, label: true, isActive: true } },
    },
  },
} satisfies Prisma.EmailTemplateInclude;

/** HU-TPL-003..011. Templates are local; Saleshandy has no template API. */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InfluencerAccessService,
  ) {}

  private fields(): Promise<CustomField[]> {
    return this.prisma.customField.findMany();
  }

  async catalog(locale: 'es' | 'en' = 'es') {
    const catalog = buildCatalog(await this.fields(), locale);
    return {
      groups: {
        influencer: catalog.filter((v) => v.source === 'influencer'),
        prospect: catalog.filter((v) => v.source === 'prospect'),
        custom: catalog.filter((v) => v.source === 'custom'),
      },
    };
  }

  async list(user: AuthUser, query: QueryTemplatesDto) {
    if (query.influencerId)
      await this.access.assertCanAccess(user, query.influencerId);
    const search = query.search?.trim();
    const base: Prisma.EmailTemplateWhereInput = {
      ...(query.influencerId ? { influencerId: query.influencerId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { subject: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const where: Prisma.EmailTemplateWhereInput = {
      ...base,
      ...(query.status === 'archived'
        ? { status: 'ARCHIVED' }
        : query.status === 'all'
          ? {}
          : { status: 'ACTIVE' }),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const [rows, total, active, archived] = await Promise.all([
      this.prisma.emailTemplate.findMany({
        where,
        include: {
          influencer: { select: { name: true } },
          createdBy: { select: { name: true } },
          updatedBy: { select: { name: true } },
        },
        orderBy: { [query.sortBy ?? 'updatedAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.emailTemplate.count({ where }),
      this.prisma.emailTemplate.count({ where: { ...base, status: 'ACTIVE' } }),
      this.prisma.emailTemplate.count({
        where: { ...base, status: 'ARCHIVED' },
      }),
    ]);
    return {
      data: rows.map((t) => {
        const dto: Partial<ReturnType<typeof toTemplateDto>> = toTemplateDto(t);
        delete dto.bodyHtml;
        delete dto.bodyText;
        return dto;
      }),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      counts: { active, archived },
    };
  }

  async findOne(user: AuthUser, id: string) {
    const template = await this.get(id);
    await this.access.assertCanAccess(user, template.influencerId);
    const full = await this.prisma.emailTemplate.findUniqueOrThrow({
      where: { id },
      include: detailInclude,
    });
    const validation = validateVariables(full, await this.fields());
    return {
      ...toTemplateDto(full),
      validation: { valid: validation.valid, issues: validation.issues },
    };
  }

  validate(dto: ValidateTemplateDto) {
    return this.fields().then((fields) => {
      const result = validateVariables(
        { ...dto, bodyHtml: sanitizeTemplateHtml(dto.bodyHtml) },
        fields,
      );
      return { valid: result.valid, issues: result.issues };
    });
  }

  async create(user: AuthUser, dto: CreateTemplateDto) {
    await this.access.assertCanAccess(user, dto.influencerId);
    const content = await this.prepareContent(dto);
    const template = await this.prisma.$transaction(async (tx) => {
      const created = await tx.emailTemplate.create({
        data: {
          influencerId: dto.influencerId,
          name: dto.name,
          subject: content.subject,
          preHeader: content.preHeader,
          bodyHtml: content.bodyHtml,
          bodyText: content.bodyText,
          influencerVariables: content.influencerKeys,
          validationIssues: content.issueCount,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      if (content.fieldReferences.length) {
        await tx.emailTemplateField.createMany({
          data: content.fieldReferences.map((r) => ({
            ...r,
            templateId: created.id,
          })),
        });
      }
      return created;
    });
    return this.findOne(user, template.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateTemplateDto) {
    const current = await this.get(id);
    await this.access.assertCanAccess(user, current.influencerId);
    if (current.status === 'ARCHIVED') {
      throw new ConflictException({
        message: 'Restore the template before editing it.',
        code: TEMPLATE_ERROR_CODES.ARCHIVED_READONLY,
      });
    }
    const contentChanged =
      dto.subject !== undefined ||
      dto.preHeader !== undefined ||
      dto.bodyHtml !== undefined;
    if (!contentChanged && dto.name === undefined) {
      throw new BadRequestException({
        message: 'Nothing to update.',
        code: TEMPLATE_ERROR_CODES.NO_CHANGES,
      });
    }
    const content = contentChanged
      ? await this.prepareContent({
          subject: dto.subject ?? current.subject,
          preHeader:
            dto.preHeader !== undefined
              ? dto.preHeader
              : (current.preHeader ?? undefined),
          bodyHtml: dto.bodyHtml ?? current.bodyHtml,
        })
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.emailTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(content
            ? {
                subject: content.subject,
                preHeader: content.preHeader,
                bodyHtml: content.bodyHtml,
                bodyText: content.bodyText,
                influencerVariables: content.influencerKeys,
                validationIssues: content.issueCount,
              }
            : {}),
          updatedById: user.id,
        },
      });
      if (content) {
        // HU-TPL-006 CA-04: refresh references for added/removed variables.
        await tx.emailTemplateField.deleteMany({ where: { templateId: id } });
        if (content.fieldReferences.length) {
          await tx.emailTemplateField.createMany({
            data: content.fieldReferences.map((r) => ({
              ...r,
              templateId: id,
            })),
          });
        }
      }
    });
    return this.findOne(user, id);
  }

  async setStatus(user: AuthUser, id: string, status: 'ACTIVE' | 'ARCHIVED') {
    const current = await this.get(id);
    await this.access.assertCanAccess(user, current.influencerId);
    if (status === 'ARCHIVED') await this.assertCanArchive(id);
    if (current.status !== status) {
      await this.prisma.emailTemplate.update({
        where: { id },
        data: { status, updatedById: user.id },
      });
    }
    return this.findOne(user, id);
  }

  /**
   * HU-TPL-007 CA-04 seam: when Sequences exist, block archiving templates used
   * by active outreach (TEMPLATE_IN_ACTIVE_OUTREACH). No dependencies today.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async assertCanArchive(templateId: string): Promise<void> {
    void templateId;
  }

  async preview(user: AuthUser, dto: PreviewTemplateDto) {
    let influencerId = dto.influencerId;
    let parts: { subject: string; preHeader?: string | null; bodyHtml: string };
    if (dto.templateId) {
      const template = await this.get(dto.templateId);
      influencerId = template.influencerId;
      parts = {
        subject: dto.subject ?? template.subject,
        preHeader: dto.preHeader ?? template.preHeader,
        bodyHtml:
          dto.bodyHtml !== undefined
            ? sanitizeTemplateHtml(dto.bodyHtml)
            : template.bodyHtml,
      };
    } else {
      if (
        !influencerId ||
        dto.subject === undefined ||
        dto.bodyHtml === undefined
      ) {
        throw new BadRequestException({
          message:
            'Send templateId, or influencerId with subject and bodyHtml.',
          code: TEMPLATE_ERROR_CODES.PREVIEW_INPUT,
        });
      }
      parts = {
        subject: dto.subject,
        preHeader: dto.preHeader,
        bodyHtml: sanitizeTemplateHtml(dto.bodyHtml),
      };
    }
    await this.access.assertCanAccess(user, influencerId);
    const [influencer, fields, prospect] = await Promise.all([
      this.prisma.influencer.findUnique({
        where: { id: influencerId },
        select: { ...influencerSelect, outgoingEmail: true },
      }),
      this.fields(),
      dto.prospectId
        ? this.prisma.prospect.findUnique({
            where: { id: dto.prospectId },
            include: { fieldValues: true },
          })
        : Promise.resolve(null),
    ]);
    if (
      dto.prospectId &&
      (!prospect || prospect.influencerId !== influencerId)
    ) {
      throw new BadRequestException({
        message: 'The prospect does not belong to this talent.',
        code: TEMPLATE_ERROR_CODES.PROSPECT_MISMATCH,
      });
    }
    const prospectData: ProspectData | null = prospect
      ? {
          ...prospect,
          customValues: new Map(
            prospect.fieldValues.map((v) => [v.customFieldId, v.value]),
          ),
        }
      : null;
    const resolved = resolveTemplate(
      parts,
      {
        influencer: influencer,
        prospect: prospectData,
        fields,
      },
      { highlightMissing: dto.highlightMissing ?? true },
    );
    const validation = validateVariables(parts, fields);
    return {
      from: influencer?.outgoingEmail || influencer?.email || null,
      to: prospect?.email ?? null,
      ...resolved,
      validationIssues: validation.issues,
    };
  }

  /** Template ready to paste into a Saleshandy sequence step (labels as merge tags). */
  async exportForSaleshandy(user: AuthUser, id: string) {
    const template = await this.get(id);
    await this.access.assertCanAccess(user, template.influencerId);
    const [influencer, fields] = await Promise.all([
      this.prisma.influencer.findUnique({
        where: { id: template.influencerId },
        select: influencerSelect,
      }),
      this.fields(),
    ]);
    return compileForSaleshandy(template, {
      influencer: influencer,
      fields,
    });
  }

  /** HU-TPL-002 CA-03: templates that depend on a field. */
  async byField(fieldId: string) {
    const refs = await this.prisma.emailTemplateField.findMany({
      where: { customFieldId: fieldId },
      include: {
        template: { include: { influencer: { select: { name: true } } } },
      },
    });
    return refs.map((r) => ({
      templateId: r.templateId,
      name: r.template.name,
      status: r.template.status,
      influencerId: r.template.influencerId,
      influencerName: r.template.influencer.name,
      locations: r.locations,
    }));
  }

  private async get(id: string) {
    const template = await this.prisma.emailTemplate.findUnique({
      where: { id },
    });
    if (!template)
      throw new NotFoundException({
        message: 'Template not found.',
        code: TEMPLATE_ERROR_CODES.NOT_FOUND,
      });
    return template;
  }

  /** Sanitizes, builds plain text and references (saving with warnings is allowed). */
  private async prepareContent(dto: {
    subject: string;
    preHeader?: string;
    bodyHtml: string;
  }) {
    const bodyHtml = sanitizeTemplateHtml(dto.bodyHtml);
    if (isEmptyBody(bodyHtml)) {
      throw new BadRequestException({
        message: 'The email body is empty.',
        code: TEMPLATE_ERROR_CODES.EMPTY_BODY,
      });
    }
    const preHeader = dto.preHeader?.trim() || null;
    const validation = validateVariables(
      { subject: dto.subject, preHeader, bodyHtml },
      await this.fields(),
    );
    return {
      subject: dto.subject.trim(),
      preHeader,
      bodyHtml,
      bodyText: htmlToPlainText(bodyHtml),
      influencerKeys: validation.influencerKeys,
      fieldReferences: validation.fieldReferences,
      issueCount: validation.issues.length,
    };
  }
}
