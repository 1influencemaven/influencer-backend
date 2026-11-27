import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { Prisma } from '../generated/prisma/client';
import { InfluencerAccessService } from '../influencers/access/influencer-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeFieldValue } from './prospects-csv.service';
import type {
  CreateProspectDto,
  QueryProspectsDto,
  UpdateProspectDto,
} from './dto/prospects.dto';
import { ProspectsIngestionService } from './prospects-ingestion.service';
import {
  domainOf,
  normalizeEmail,
  toProspectDto,
  type ProspectDto,
} from './prospects.mapper';

const include = {
  influencer: { select: { name: true } },
  brandCandidate: { select: { name: true } },
  agency: { select: { name: true } },
  fieldValues: {
    include: { customField: { select: { id: true, key: true, label: true } } },
  },
} satisfies Prisma.ProspectInclude;

const EDITABLE = [
  'firstName',
  'lastName',
  'jobTitle',
  'company',
  'companyDomain',
  'website',
  'linkedInUrl',
  'country',
  'phoneNumber',
  'mailboxLabel',
] as const;

@Injectable()
export class ProspectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InfluencerAccessService,
    private readonly ingestion: ProspectsIngestionService,
  ) {}

  async list(user: AuthUser, query: QueryProspectsDto) {
    if (query.influencerId)
      await this.access.assertCanAccess(user, query.influencerId);
    const search = query.search?.trim();
    const base: Prisma.ProspectWhereInput = {
      ...(query.influencerId ? { influencerId: query.influencerId } : {}),
      ...(query.brandCandidateId
        ? { brandCandidateId: query.brandCandidateId }
        : {}),
      ...(search
        ? {
            OR: [
              { emailNormalized: { contains: search.toLowerCase() } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { company: { contains: search, mode: 'insensitive' } },
              { companyDomain: { contains: search, mode: 'insensitive' } },
              { mailboxLabel: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const where: Prisma.ProspectWhereInput = {
      ...base,
      ...(query.source ? { source: query.source } : {}),
      ...(query.contactKind ? { contactKind: query.contactKind } : {}),
      ...(query.isGeneric !== undefined ? { isGeneric: query.isGeneric } : {}),
      ...(query.status === 'archived'
        ? { status: 'ARCHIVED' }
        : query.status === 'all'
          ? {}
          : { status: 'ACTIVE' }),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const sortBy = query.sortBy ?? 'createdAt';
    const orderBy: Prisma.ProspectOrderByWithRelationInput =
      sortBy === 'email'
        ? { emailNormalized: query.sortOrder ?? 'asc' }
        : { [sortBy]: query.sortOrder ?? 'desc' };

    const [rows, total, bySource, active, archived] = await Promise.all([
      this.prisma.prospect.findMany({
        where,
        include,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.prospect.count({ where }),
      this.prisma.prospect.groupBy({
        by: ['source'],
        where: { ...base, status: 'ACTIVE' },
        _count: true,
      }),
      this.prisma.prospect.count({ where: { ...base, status: 'ACTIVE' } }),
      this.prisma.prospect.count({ where: { ...base, status: 'ARCHIVED' } }),
    ]);
    return {
      data: rows.map(toProspectDto),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      counts: {
        active,
        archived,
        bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count])),
      },
    };
  }

  async findOne(user: AuthUser, id: string): Promise<ProspectDto> {
    const prospect = await this.prisma.prospect.findUnique({
      where: { id },
      include,
    });
    if (!prospect)
      throw new NotFoundException({
        message: 'Prospect not found.',
        code: 'PROSPECT_NOT_FOUND',
      });
    await this.access.assertCanAccess(user, prospect.influencerId);
    return toProspectDto(prospect);
  }

  async create(user: AuthUser, dto: CreateProspectDto): Promise<ProspectDto> {
    await this.access.assertCanAccess(user, dto.influencerId);
    const exists = await this.prisma.prospect.findUnique({
      where: {
        influencerId_emailNormalized: {
          influencerId: dto.influencerId,
          emailNormalized: normalizeEmail(dto.email),
        },
      },
      select: { id: true },
    });
    if (exists) {
      throw new ConflictException({
        message: 'This email is already a prospect for this talent.',
        code: 'PROSPECT_DUPLICATE',
      });
    }
    const attributes = Object.fromEntries(
      EDITABLE.map((k) => [k, dto[k] || null]),
    );
    const prospect = await this.prisma.$transaction((tx) =>
      this.ingestion.upsert(tx, {
        influencerId: dto.influencerId,
        email: dto.email,
        source: 'MANUAL',
        attributes: {
          ...attributes,
          companyDomain: dto.companyDomain || domainOf(dto.website),
          contactKind: dto.firstName ? 'PERSON' : 'MAILBOX',
          isGeneric: !dto.firstName,
        },
        tags: dto.tags,
        createdById: user.id,
      }),
    );
    return this.findOne(user, prospect.prospect.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateProspectDto,
  ): Promise<ProspectDto> {
    const prospect = await this.prisma.prospect.findUnique({
      where: { id },
      select: { id: true, influencerId: true },
    });
    if (!prospect)
      throw new NotFoundException({
        message: 'Prospect not found.',
        code: 'PROSPECT_NOT_FOUND',
      });
    await this.access.assertCanAccess(user, prospect.influencerId);

    const data: Prisma.ProspectUncheckedUpdateInput = {};
    for (const key of EDITABLE)
      if (dto[key] !== undefined) data[key] = dto[key] || null;
    if (dto.firstName) {
      data.contactKind = 'PERSON';
      data.isGeneric = false;
    }
    if (dto.tags !== undefined)
      data.tags = [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))];
    if (dto.status) data.status = dto.status;

    const fieldIds = (dto.customFields ?? []).map((f) => f.fieldId);
    const fields = fieldIds.length
      ? await this.prisma.customField.findMany({
          where: { id: { in: fieldIds }, isActive: true },
        })
      : [];
    const values: Array<{ fieldId: string; value: string | null }> = [];
    for (const item of dto.customFields ?? []) {
      const field = fields.find((f) => f.id === item.fieldId);
      if (!field)
        throw new BadRequestException({
          message: 'Unknown or disabled field.',
          code: 'PROSPECT_UNKNOWN_FIELD',
        });
      if (!item.value.trim()) {
        values.push({ fieldId: field.id, value: null });
        continue;
      }
      const result = normalizeFieldValue(field, item.value);
      if (!result.ok) {
        throw new BadRequestException({
          message: `Invalid value for "${field.label}".`,
          code: 'PROSPECT_INVALID_FIELD_VALUE',
        });
      }
      values.push({ fieldId: field.id, value: result.value });
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length)
        await tx.prospect.update({ where: { id }, data });
      for (const { fieldId, value } of values) {
        const key = {
          prospectId_customFieldId: { prospectId: id, customFieldId: fieldId },
        };
        if (value === null)
          await tx.prospectFieldValue.deleteMany({
            where: { prospectId: id, customFieldId: fieldId },
          });
        else
          await tx.prospectFieldValue.upsert({
            where: key,
            create: { prospectId: id, customFieldId: fieldId, value },
            update: { value },
          });
      }
    });
    return this.findOne(user, id);
  }

  async importJobs(user: AuthUser, influencerId?: string) {
    if (influencerId) await this.access.assertCanAccess(user, influencerId);
    return this.prisma.prospectSyncJob.findMany({
      where: influencerId ? { influencerId } : {},
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
