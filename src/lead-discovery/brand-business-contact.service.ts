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
  commercialCoverageTierFromRelevance,
  normalizeBusinessEmail,
} from './utils/commercial-relevance.util';
import {
  assessBrandBusinessContactEmailDomain,
  labelFromEmailLocalPart,
} from './utils/brand-business-contact-domain.util';
import {
  CONTACT_EMAIL_ATTRIBUTION_STATUS,
  CONTACT_EMAIL_DISCOVERY_STATUS,
  CONTACT_EMAIL_VERIFICATION_STATUS,
  type ContactEmailAttributionStatus,
  type ContactEmailDiscoveryStatus,
  type ContactEmailVerificationStatus,
} from './utils/contact-email-attribution.util';

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
  /**
   * RF-02.1: commercial coverage tier for UI/metrics.
   * Orthogonal to Prisma commercialRelevance; OTHER ≠ GENERAL.
   */
  commercialCoverageTier: 'HIGH' | 'MEDIUM' | 'GENERAL' | 'LOW' | 'OTHER';
  source: ContactChannelSource;
  sourceUrl: string | null;
  evidences: BusinessContactEvidence[];
  /** RF-01: literal discovery concept (FOUND). */
  discoveryStatus: ContactEmailDiscoveryStatus;
  /** RF-01: brand association strength. */
  attributionStatus: ContactEmailAttributionStatus;
  /** RF-01: mailbox verification — UNVERIFIED unless real verify exists. */
  verificationStatus: ContactEmailVerificationStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertBrandBusinessContactInput = {
  brandCandidateId: string;
  email: string;
  sourceUrl: string;
  evidenceSnippet: string;
  /** Official brand domain used for RF-01 attribution gate. */
  brandDomain: string;
  /** Alternate corroborated corporate domains (regional/parent). */
  corroboratedDomains?: string[];
  commercialRelevance?: CommercialRelevance;
  isGeneric?: boolean;
  label?: string | null;
};

export type UpsertBrandBusinessContactResult = {
  id: string | null;
  created: boolean;
  updated: boolean;
  skipped: boolean;
  skipReason?: string;
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

type ContactProvenanceMetadata = {
  evidences: BusinessContactEvidence[];
  discoveryStatus: ContactEmailDiscoveryStatus;
  attributionStatus: ContactEmailAttributionStatus;
  verificationStatus: ContactEmailVerificationStatus;
  domainAssessmentReason?: string;
};

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

    return ranked.map((row) => {
      const provenance = this.readProvenance(row.metadata);
      return {
        id: row.id,
        brandCandidateId: row.brandCandidateId,
        email: row.email,
        label: row.label,
        isGeneric: row.isGeneric,
        commercialRelevance: row.commercialRelevance,
        commercialCoverageTier: commercialCoverageTierFromRelevance(
          row.commercialRelevance,
          row.email,
        ),
        source: row.source,
        sourceUrl: row.sourceUrl,
        evidences: provenance.evidences,
        discoveryStatus: provenance.discoveryStatus,
        attributionStatus: provenance.attributionStatus,
        verificationStatus: provenance.verificationStatus,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async upsertFromDiscovery(
    input: UpsertBrandBusinessContactInput,
  ): Promise<UpsertBrandBusinessContactResult> {
    const emailNormalized = normalizeBusinessEmail(input.email);
    const assessment = assessBrandBusinessContactEmailDomain(
      emailNormalized,
      input.brandDomain,
      input.corroboratedDomains ?? [],
    );

    if (assessment.decision === 'reject') {
      return {
        id: null,
        created: false,
        updated: false,
        skipped: true,
        skipReason: `domain_${assessment.reason}`,
      };
    }

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
    const provenanceBase: ContactProvenanceMetadata = {
      evidences: [evidence],
      discoveryStatus: CONTACT_EMAIL_DISCOVERY_STATUS.FOUND,
      attributionStatus: CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED,
      verificationStatus: CONTACT_EMAIL_VERIFICATION_STATUS.UNVERIFIED,
      domainAssessmentReason: assessment.reason,
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
          metadata: provenanceBase as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return {
        id: created.id,
        created: true,
        updated: false,
        skipped: false,
      };
    }

    const mergedEvidences = this.mergeEvidences(existing.metadata, evidence);
    const nextRelevance = pickStrongerRelevance(
      existing.commercialRelevance,
      commercialRelevance,
    );
    const nextIsGeneric = existing.isGeneric || isGeneric;
    const previous = this.readProvenance(existing.metadata);
    const mergedProvenance: ContactProvenanceMetadata = {
      evidences: mergedEvidences,
      discoveryStatus: CONTACT_EMAIL_DISCOVERY_STATUS.FOUND,
      // Never downgrade ATTRIBUTED → UNATTRIBUTED on refresh.
      attributionStatus:
        previous.attributionStatus ===
        CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED
          ? CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED
          : CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED,
      // Never invent VERIFIED — preserve UNVERIFIED unless a future real verify wrote VERIFIED.
      verificationStatus:
        previous.verificationStatus ===
        CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
          ? CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
          : CONTACT_EMAIL_VERIFICATION_STATUS.UNVERIFIED,
      domainAssessmentReason: assessment.reason,
    };

    await this.prisma.brandBusinessContact.update({
      where: { id: existing.id },
      data: {
        commercialRelevance: nextRelevance,
        isGeneric: nextIsGeneric,
        label: existing.label || label,
        sourceUrl: existing.sourceUrl || input.sourceUrl,
        metadata: mergedProvenance as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      id: existing.id,
      created: false,
      updated: true,
      skipped: false,
    };
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
    } else {
      // Prefer longer literal evidence snippet for the same URL (higher quality).
      const prior = byUrl.get(key)!;
      if (incoming.evidenceSnippet.length > prior.evidenceSnippet.length) {
        byUrl.set(key, { ...prior, evidenceSnippet: incoming.evidenceSnippet });
      }
    }
    return [...byUrl.values()];
  }

  private readProvenance(metadata: unknown): ContactProvenanceMetadata {
    const evidences = this.readEvidences(metadata);
    const raw =
      metadata && typeof metadata === 'object'
        ? (metadata as Record<string, unknown>)
        : {};

    const discoveryStatus =
      raw.discoveryStatus === CONTACT_EMAIL_DISCOVERY_STATUS.FOUND
        ? CONTACT_EMAIL_DISCOVERY_STATUS.FOUND
        : CONTACT_EMAIL_DISCOVERY_STATUS.FOUND;

    const attributionStatus =
      raw.attributionStatus === CONTACT_EMAIL_ATTRIBUTION_STATUS.UNATTRIBUTED
        ? CONTACT_EMAIL_ATTRIBUTION_STATUS.UNATTRIBUTED
        : CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED;

    const verificationStatus =
      raw.verificationStatus === CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
        ? CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
        : CONTACT_EMAIL_VERIFICATION_STATUS.UNVERIFIED;

    return {
      evidences,
      discoveryStatus,
      // Historical rows without provenance: treat as FOUND + ATTRIBUTED + UNVERIFIED
      // (they were persisted under the old writer; UI must not imply SMTP verify).
      attributionStatus:
        raw.attributionStatus == null
          ? CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED
          : attributionStatus,
      verificationStatus,
      domainAssessmentReason:
        typeof raw.domainAssessmentReason === 'string'
          ? raw.domainAssessmentReason
          : undefined,
    };
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
