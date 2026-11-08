import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  CommercialRelevance,
  ContactChannelSource,
} from '../generated/prisma/enums';

import { PrismaService } from '../prisma/prisma.service';
import { classifyPublicEmailGeneric } from './utils/public-email-generic.util';
import {
  classifyCommercialRelevance,
  normalizeBusinessEmail,
} from './utils/commercial-relevance.util';
import { labelFromEmailLocalPart } from './utils/brand-business-contact-domain.util';

export type BusinessContactEvidence = {
  sourceUrl: string;
  evidenceSnippet: string;
  discoveredAt: string;
};

export type BrandBusinessContactResponse = {
  id: string;
  brandCandidateId: string;
  email: string;
  label: string | null;
  isGeneric: boolean;
  commercialRelevance: CommercialRelevance;
  source: ContactChannelSource;
  sourceUrl: string | null;
  evidences: BusinessContactEvidence[];
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertBrandBusinessContactInput = {
  brandCandidateId: string;
  email: string;
  sourceUrl: string;
  evidenceSnippet: string;
  commercialRelevance?: CommercialRelevance;
  isGeneric?: boolean;
  label?: string | null;
};

export type UpsertBrandBusinessContactResult = {
  id: string;
  created: boolean;
  updated: boolean;
};

function relevanceRank(value: CommercialRelevance): number {
  switch (value) {
    case CommercialRelevance.HIGH:
      return 3;
    case CommercialRelevance.UNKNOWN:
      return 2;
    case CommercialRelevance.NEUTRAL:
      return 1;
    case CommercialRelevance.LOW:
      return 0;
    default:
      return 0;
  }
}

function pickStrongerRelevance(
  current: CommercialRelevance,
  incoming: CommercialRelevance,
): CommercialRelevance {
  return relevanceRank(incoming) > relevanceRank(current) ? incoming : current;
}

@Injectable()
export class BrandBusinessContactService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read-only Visibility (v2 Phase 1).
   * 404 if BrandCandidate missing; empty array if none persisted.
   */
  async listByBrandCandidateId(
    brandCandidateId: string,
  ): Promise<BrandBusinessContactResponse[]> {
    const brand = await this.prisma.brandCandidate.findUnique({
      where: { id: brandCandidateId },
      select: { id: true },
    });
    if (!brand) {
      throw new NotFoundException(
        `Brand candidate ${brandCandidateId} not found`,
      );
    }

    const rows = await this.prisma.brandBusinessContact.findMany({
      where: { brandCandidateId },
      orderBy: { createdAt: 'desc' },
    });

    // Prefer HIGH first (business rank, not Prisma enum ordinal).
    const ranked = [...rows].sort((a, b) => {
      const rankDiff =
        relevanceRank(b.commercialRelevance) -
        relevanceRank(a.commercialRelevance);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return ranked.map((row) => ({
      id: row.id,
      brandCandidateId: row.brandCandidateId,
      email: row.email,
      label: row.label,
      isGeneric: row.isGeneric,
      commercialRelevance: row.commercialRelevance,
      source: row.source,
      sourceUrl: row.sourceUrl,
      evidences: this.readEvidences(row.metadata),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async upsertFromDiscovery(
    input: UpsertBrandBusinessContactInput,
  ): Promise<UpsertBrandBusinessContactResult> {
    const emailNormalized = normalizeBusinessEmail(input.email);
    const isGeneric =
      input.isGeneric ?? classifyPublicEmailGeneric(emailNormalized);
    const commercialRelevance =
      input.commercialRelevance ?? classifyCommercialRelevance(emailNormalized);
    const label =
      input.label ?? labelFromEmailLocalPart(emailNormalized) ?? null;
    const evidence: BusinessContactEvidence = {
      sourceUrl: input.sourceUrl,
      evidenceSnippet: input.evidenceSnippet,
      discoveredAt: new Date().toISOString(),
    };

    const existing = await this.prisma.brandBusinessContact.findUnique({
      where: {
        brandCandidateId_emailNormalized: {
          brandCandidateId: input.brandCandidateId,
          emailNormalized,
        },
      },
    });

    if (!existing) {
      const created = await this.prisma.brandBusinessContact.create({
        data: {
          brandCandidateId: input.brandCandidateId,
          email: emailNormalized,
          emailNormalized,
          label,
          isGeneric,
          commercialRelevance,
          source: ContactChannelSource.PUBLIC_WEB,
          sourceUrl: input.sourceUrl,
          metadata: { evidences: [evidence] },
        },
        select: { id: true },
      });
      return { id: created.id, created: true, updated: false };
    }

    const mergedEvidences = this.mergeEvidences(existing.metadata, evidence);
    const nextRelevance = pickStrongerRelevance(
      existing.commercialRelevance,
      commercialRelevance,
    );
    const nextIsGeneric = existing.isGeneric || isGeneric;

    await this.prisma.brandBusinessContact.update({
      where: { id: existing.id },
      data: {
        commercialRelevance: nextRelevance,
        isGeneric: nextIsGeneric,
        label: existing.label || label,
        sourceUrl: existing.sourceUrl || input.sourceUrl,
        metadata: { evidences: mergedEvidences },
      },
    });

    return { id: existing.id, created: false, updated: true };
  }

  private mergeEvidences(
    metadata: unknown,
    incoming: BusinessContactEvidence,
  ): BusinessContactEvidence[] {
    const existing = this.readEvidences(metadata);
    const byUrl = new Map<string, BusinessContactEvidence>();
    for (const item of existing) {
      byUrl.set(item.sourceUrl.toLowerCase(), item);
    }
    const key = incoming.sourceUrl.toLowerCase();
    if (!byUrl.has(key)) {
      byUrl.set(key, incoming);
    }
    return [...byUrl.values()];
  }

  private readEvidences(metadata: unknown): BusinessContactEvidence[] {
    if (!metadata || typeof metadata !== 'object') {
      return [];
    }
    const evidences = (metadata as { evidences?: unknown }).evidences;
    if (!Array.isArray(evidences)) {
      return [];
    }
    return evidences.filter(
      (item): item is BusinessContactEvidence =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as BusinessContactEvidence).sourceUrl === 'string' &&
        typeof (item as BusinessContactEvidence).evidenceSnippet === 'string',
    );
  }
}
