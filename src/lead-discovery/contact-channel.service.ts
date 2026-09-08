import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  ContactChannelSource,
  ContactChannelStatus,
  ContactChannelType,
  LeadEmailConfidence,
} from '../generated/prisma/enums';

import { PrismaService } from '../prisma/prisma.service';
import type { AddContactChannelDto } from './dto/add-contact-channel.dto';
import type {
  PublicEmailCandidate,
  PublicEmailDiscoveryResult,
} from './interfaces/public-email-evidence.interface';
import { emailLiteralInEvidence } from './utils/literal-email-extract.util';
import { normalizeChannelValue } from './utils/contact-channel-normalize.util';
import {
  computeOutreachReadiness,
  type OutreachReadiness,
} from './utils/outreach-readiness.util';

export const contactChannelSelect = {
  id: true,
  leadId: true,
  type: true,
  value: true,
  status: true,
  source: true,
  sourceUrl: true,
  isGeneric: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ContactChannelRow = Prisma.ContactChannelGetPayload<{
  select: typeof contactChannelSelect;
}>;

export type CreateChannelInput = {
  type: ContactChannelType;
  value: string;
  source: ContactChannelSource;
  sourceUrl?: string;
  isGeneric?: boolean;
  metadata?: Prisma.InputJsonValue;
  status?: ContactChannelStatus;
};

export type EnrichmentStats = {
  channelsAdded: { linkedin: number; website: number; email: number };
  genericEmails: number;
  nonGenericEmails: number;
  pagesAttempted: number;
  pagesSucceeded: number;
  errors: number;
};

@Injectable()
export class ContactChannelService {
  constructor(private readonly prisma: PrismaService) {}

  async addChannel(
    leadId: string,
    dto: AddContactChannelDto,
  ): Promise<ContactChannelRow> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });
    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }

    this.validateChannelInput(dto);

    const valueNormalized = normalizeChannelValue(dto.type, dto.value);
    const existing = await this.prisma.contactChannel.findUnique({
      where: {
        leadId_type_valueNormalized: {
          leadId,
          type: dto.type,
          valueNormalized,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Contact channel ${dto.type} already exists for this lead`,
      );
    }

    const channel = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contactChannel.create({
        data: {
          leadId,
          type: dto.type,
          value: dto.value.trim(),
          valueNormalized,
          source: dto.source,
          sourceUrl: dto.sourceUrl?.trim() || null,
          isGeneric: dto.isGeneric ?? null,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
          status: ContactChannelStatus.ACTIVE,
        },
        select: contactChannelSelect,
      });
      await this.syncLegacyLeadFields(tx, leadId);
      return created;
    });

    return channel;
  }

  async listChannels(leadId: string): Promise<ContactChannelRow[]> {
    return this.prisma.contactChannel.findMany({
      where: { leadId },
      select: contactChannelSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  computeReadiness(channels: ContactChannelRow[]): OutreachReadiness {
    return computeOutreachReadiness(channels);
  }

  validateChannelInput(dto: AddContactChannelDto | CreateChannelInput): void {
    if (dto.type === ContactChannelType.EMAIL) {
      const email = dto.value.trim().toLowerCase();
      if (!email.includes('@')) {
        throw new BadRequestException('Invalid email value');
      }
      if (dto.source === ContactChannelSource.PUBLIC_WEB) {
        this.assertPublicWebEmailEvidence(email, dto.metadata);
      }
    }
  }

  assertPublicWebEmailEvidence(
    email: string,
    metadata: unknown,
  ): void {
    const evidences = this.extractEvidences(metadata);
    if (evidences.length === 0) {
      throw new BadRequestException(
        'PUBLIC_WEB email requires metadata.evidences with literal email in snippet',
      );
    }
    const hasLiteral = evidences.some((evidence) => {
      const snippet = String(evidence.evidenceSnippet ?? '');
      return emailLiteralInEvidence(email, snippet);
    });
    if (!hasLiteral) {
      throw new BadRequestException(
        'Email must exist literally in at least one evidence snippet',
      );
    }
  }

  async createChannelsForLead(
    tx: Prisma.TransactionClient,
    leadId: string,
    channels: CreateChannelInput[],
  ): Promise<void> {
    for (const channel of channels) {
      await this.upsertChannel(tx, leadId, channel);
    }
    await this.syncLegacyLeadFields(tx, leadId);
  }

  async persistPublicEmailEnrichment(
    tx: Prisma.TransactionClient,
    leadId: string,
    result: PublicEmailDiscoveryResult,
  ): Promise<EnrichmentStats> {
    const stats: EnrichmentStats = {
      channelsAdded: { linkedin: 0, website: 0, email: 0 },
      genericEmails: result.summary.genericEmailsFound,
      nonGenericEmails: result.summary.nonGenericEmailsFound,
      pagesAttempted: result.summary.pagesAttempted,
      pagesSucceeded: result.summary.pagesSucceeded,
      errors: result.summary.errors,
    };

    const website = result.summary.website?.trim();
    if (website) {
      const created = await this.upsertChannel(tx, leadId, {
        type: ContactChannelType.WEBSITE,
        value: website,
        source: ContactChannelSource.BRAND_WEBSITE,
      });
      if (created) {
        stats.channelsAdded.website += 1;
      }
    }

    for (const candidate of result.candidates) {
      const channelInput = this.mapPublicEmailCandidateToChannel(candidate);
      const created = await this.upsertChannel(tx, leadId, channelInput);
      if (created) {
        stats.channelsAdded.email += 1;
      }
    }

    await this.syncLegacyLeadFields(tx, leadId);
    return stats;
  }

  mapPublicEmailCandidateToChannel(
    candidate: PublicEmailCandidate,
  ): CreateChannelInput {
    const metadata = {
      evidences: candidate.evidences.map((evidence) => ({
        sourceUrl: evidence.sourceUrl,
        evidenceSnippet: evidence.evidenceSnippet,
        discoveredAt: evidence.discoveredAt,
      })),
    };
    return {
      type: ContactChannelType.EMAIL,
      value: candidate.email,
      source: ContactChannelSource.PUBLIC_WEB,
      sourceUrl: candidate.evidences[0]?.sourceUrl,
      isGeneric: candidate.isGeneric,
      metadata,
    };
  }

  private async upsertChannel(
    tx: Prisma.TransactionClient,
    leadId: string,
    channel: CreateChannelInput,
  ): Promise<boolean> {
    this.validateChannelInput(channel);
    const valueNormalized = normalizeChannelValue(channel.type, channel.value);
    const existing = await tx.contactChannel.findUnique({
      where: {
        leadId_type_valueNormalized: {
          leadId,
          type: channel.type,
          valueNormalized,
        },
      },
    });

    if (existing) {
      const mergedMetadata = this.mergeEvidenceMetadata(
        existing.metadata,
        channel.metadata,
      );
      const metadataChanged =
        JSON.stringify(existing.metadata ?? null) !==
        JSON.stringify(mergedMetadata ?? null);
      if (metadataChanged) {
        await tx.contactChannel.update({
          where: { id: existing.id },
          data: {
            metadata: mergedMetadata,
            sourceUrl:
              channel.sourceUrl?.trim() ||
              existing.sourceUrl,
            isGeneric: channel.isGeneric ?? existing.isGeneric,
          },
        });
      }
      return false;
    }

    await tx.contactChannel.create({
      data: {
        leadId,
        type: channel.type,
        value: channel.value.trim(),
        valueNormalized,
        source: channel.source,
        sourceUrl: channel.sourceUrl?.trim() || null,
        isGeneric: channel.isGeneric ?? null,
        metadata: channel.metadata,
        status: channel.status ?? ContactChannelStatus.ACTIVE,
      },
    });
    return true;
  }

  private mergeEvidenceMetadata(
    existing: Prisma.JsonValue | null,
    incoming: Prisma.InputJsonValue | undefined,
  ): Prisma.InputJsonValue | undefined {
    const existingEvidences = this.extractEvidences(existing);
    const incomingEvidences = this.extractEvidences(incoming);
    if (existingEvidences.length === 0 && incomingEvidences.length === 0) {
      return incoming ?? (existing as Prisma.InputJsonValue | undefined);
    }

    const byUrl = new Map<
      string,
      { sourceUrl?: string; evidenceSnippet?: string; discoveredAt?: string }
    >();
    for (const evidence of existingEvidences) {
      const url = String(
        (evidence as { sourceUrl?: string }).sourceUrl ?? '',
      ).trim();
      if (url) {
        byUrl.set(url, evidence as never);
      }
    }
    for (const evidence of incomingEvidences) {
      const url = String(
        (evidence as { sourceUrl?: string }).sourceUrl ?? '',
      ).trim();
      if (url && !byUrl.has(url)) {
        byUrl.set(url, evidence as never);
      }
    }

    const base =
      incoming && typeof incoming === 'object' && !Array.isArray(incoming)
        ? { ...(incoming as Record<string, unknown>) }
        : existing && typeof existing === 'object' && !Array.isArray(existing)
          ? { ...(existing as Record<string, unknown>) }
          : {};

    return {
      ...base,
      evidences: [...byUrl.values()],
    } as Prisma.InputJsonValue;
  }

  async syncLegacyLeadFields(
    tx: Prisma.TransactionClient,
    leadId: string,
  ): Promise<void> {
    const channels = await tx.contactChannel.findMany({
      where: { leadId, status: ContactChannelStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
    });

    const emailChannel = channels.find(
      (c) => c.type === ContactChannelType.EMAIL,
    );
    const linkedInChannel = channels.find(
      (c) => c.type === ContactChannelType.LINKEDIN,
    );

    await tx.lead.update({
      where: { id: leadId },
      data: {
        email: emailChannel?.value ?? null,
        isGeneric: emailChannel?.isGeneric ?? false,
        emailConfidence: emailChannel
          ? LeadEmailConfidence.UNKNOWN
          : LeadEmailConfidence.UNKNOWN,
        profileUrl: linkedInChannel?.value ?? null,
      },
    });
  }

  private extractEvidences(
    metadata: unknown,
  ): Array<{ evidenceSnippet?: string }> {
    if (!metadata || typeof metadata !== 'object') {
      return [];
    }
    const evidences = (metadata as { evidences?: unknown }).evidences;
    if (!Array.isArray(evidences)) {
      return [];
    }
    return evidences.filter(
      (item): item is { evidenceSnippet?: string } =>
        typeof item === 'object' && item !== null,
    );
  }
}
