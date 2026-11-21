import { Injectable } from '@nestjs/common';
import type { AgencyDiscoveryCandidate } from '@influence-maven/ai-contracts';
import type { Prisma } from '../generated/prisma/client';
import {
  AgencyRelevanceStatus,
  AgencyType,
} from '../generated/prisma/enums';

import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeAgencyDomain,
  normalizeAgencyName,
} from '../lead-discovery/utils/agency-domain.util';

const AGENCY_TYPE_RANK: Record<AgencyType, number> = {
  INFLUENCER_MARKETING_AGENCY: 5,
  TALENT_REPRESENTATION: 4,
  MARKETPLACE: 3,
  GENERAL_MARKETING: 2,
  DIRECTORY: 1,
  OTHER: 0,
};

const RELEVANCE_RANK: Record<AgencyRelevanceStatus, number> = {
  RELEVANT: 3,
  UNDER_REVIEW: 2,
  NOT_RELEVANT: 1,
  DISCARDED: 0,
};

function mergeStringLists(existing: string[], incoming: string[], max = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...existing, ...incoming]) {
    const v = raw?.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function pickStrongerAgencyType(
  current: AgencyType,
  incoming: AgencyType,
): AgencyType {
  return AGENCY_TYPE_RANK[incoming] >= AGENCY_TYPE_RANK[current]
    ? incoming
    : current;
}

/**
 * Prefer higher commercial relevance; never "upgrade" DISCARDED via weak OTHER
 * noise, but allow DISCARDED → better when new evidence is stronger.
 */
function pickStrongerRelevance(
  current: AgencyRelevanceStatus,
  incoming: AgencyRelevanceStatus,
): AgencyRelevanceStatus {
  return RELEVANCE_RANK[incoming] >= RELEVANCE_RANK[current]
    ? incoming
    : current;
}

export type PersistAgencyDiscoveryResult = {
  agencyId: string;
  associationId: string;
  agencyCreated: boolean;
  associationCreated: boolean;
  domain: string;
};

@Injectable()
export class AgencyPersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertCandidate(params: {
    influencerId: string;
    candidate: AgencyDiscoveryCandidate;
    searchMetadata?: Prisma.InputJsonValue | null;
  }): Promise<PersistAgencyDiscoveryResult> {
    const { influencerId, candidate } = params;
    const domain = normalizeAgencyDomain(candidate.agency.domain);
    if (!domain) {
      throw new Error('AGENCY_DOMAIN_REQUIRED');
    }

    const normalizedName = normalizeAgencyName(candidate.agency.name);
    const agencyType = candidate.agency.agencyType as AgencyType;
    const relevanceStatus = candidate.association
      .relevanceStatus as AgencyRelevanceStatus;

    const existingAgency = await this.prisma.agency.findUnique({
      where: { domain },
    });

    let agencyId: string;
    let agencyCreated = false;

    if (!existingAgency) {
      const created = await this.prisma.agency.create({
        data: {
          name: candidate.agency.name.trim(),
          normalizedName,
          domain,
          website: candidate.agency.website ?? `https://${domain}`,
          country: candidate.agency.country ?? null,
          description: candidate.agency.description ?? null,
          agencyType,
        },
        select: { id: true },
      });
      agencyId = created.id;
      agencyCreated = true;
    } else {
      agencyId = existingAgency.id;
      const nextType = pickStrongerAgencyType(
        existingAgency.agencyType,
        agencyType,
      );
      await this.prisma.agency.update({
        where: { id: agencyId },
        data: {
          // Prefer a more specific name when current looks like a domain label.
          name:
            existingAgency.name.length >= candidate.agency.name.trim().length
              ? existingAgency.name
              : candidate.agency.name.trim(),
          normalizedName: normalizeAgencyName(
            existingAgency.name.length >= candidate.agency.name.trim().length
              ? existingAgency.name
              : candidate.agency.name.trim(),
          ),
          website: existingAgency.website ?? candidate.agency.website ?? null,
          country: existingAgency.country ?? candidate.agency.country ?? null,
          description:
            existingAgency.description &&
            existingAgency.description.length >=
              (candidate.agency.description?.length ?? 0)
              ? existingAgency.description
              : (candidate.agency.description ?? existingAgency.description),
          agencyType: nextType,
        },
      });
    }

    const evidenceUrls = mergeStringLists(
      [],
      candidate.association.evidenceUrls ?? [],
    );
    const niches = mergeStringLists([], candidate.association.niches ?? []);
    const markets = mergeStringLists([], candidate.association.markets ?? []);

    const existingAssoc = await this.prisma.influencerAgency.findUnique({
      where: {
        influencerId_agencyId: { influencerId, agencyId },
      },
    });

    if (!existingAssoc) {
      const created = await this.prisma.influencerAgency.create({
        data: {
          influencerId,
          agencyId,
          relevanceStatus,
          relevanceExplanation:
            candidate.association.relevanceExplanation ?? null,
          niches,
          markets,
          evidenceUrls,
          searchMetadata: params.searchMetadata ?? undefined,
          discoveredAt: new Date(),
        },
        select: { id: true },
      });
      return {
        agencyId,
        associationId: created.id,
        agencyCreated,
        associationCreated: true,
        domain,
      };
    }

    const mergedUrls = mergeStringLists(
      existingAssoc.evidenceUrls,
      evidenceUrls,
    );
    const mergedNiches = mergeStringLists(existingAssoc.niches, niches);
    const mergedMarkets = mergeStringLists(existingAssoc.markets, markets);
    const nextRelevance = pickStrongerRelevance(
      existingAssoc.relevanceStatus,
      relevanceStatus,
    );
    const nextExplanation =
      RELEVANCE_RANK[relevanceStatus] >=
      RELEVANCE_RANK[existingAssoc.relevanceStatus]
        ? (candidate.association.relevanceExplanation ??
          existingAssoc.relevanceExplanation)
        : existingAssoc.relevanceExplanation;

    const updated = await this.prisma.influencerAgency.update({
      where: { id: existingAssoc.id },
      data: {
        relevanceStatus: nextRelevance,
        relevanceExplanation: nextExplanation,
        niches: mergedNiches,
        markets: mergedMarkets,
        evidenceUrls: mergedUrls,
        ...(params.searchMetadata != null
          ? { searchMetadata: params.searchMetadata }
          : {}),
      },
      select: { id: true },
    });

    return {
      agencyId,
      associationId: updated.id,
      agencyCreated,
      associationCreated: false,
      domain,
    };
  }
}
