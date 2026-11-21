import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  AgencyContactKind,
  AgencyRelevanceStatus,
  CommercialRelevance,
} from '../generated/prisma/enums';

import { PrismaService } from '../prisma/prisma.service';
import { classifyPublicEmailGeneric } from '../lead-discovery/utils/public-email-generic.util';
import {
  classifyCommercialRelevance,
  normalizeBusinessEmail,
} from '../lead-discovery/utils/commercial-relevance.util';
import { labelFromEmailLocalPart } from '../lead-discovery/utils/brand-business-contact-domain.util';
import {
  CONTACT_EMAIL_ATTRIBUTION_STATUS,
  CONTACT_EMAIL_DISCOVERY_STATUS,
  CONTACT_EMAIL_VERIFICATION_STATUS,
  type ContactEmailAttributionStatus,
  type ContactEmailDiscoveryStatus,
  type ContactEmailVerificationStatus,
} from '../lead-discovery/utils/contact-email-attribution.util';
import { assessAgencyContactEmailDomain } from './utils/agency-contact-domain.util';
import {
  agencyContactEligibilitySkipReason,
  isAgencyEligibleForContactResearch,
} from './utils/agency-contact-eligibility.util';
import { outreachRoleFromEmailLocalPart } from './utils/agency-contact-outreach-role.util';

export type AgencyContactEvidence = {
  sourceUrl: string;
  evidenceSnippet: string;
  discoveredAt: string;
};

export type AgencyContactProvenanceMetadata = {
  evidences: AgencyContactEvidence[];
  discoveryStatus: ContactEmailDiscoveryStatus;
  attributionStatus: ContactEmailAttributionStatus;
  verificationStatus: ContactEmailVerificationStatus;
  domainAssessmentReason?: string;
  outreachRole?: string;
  sourceKind?: string;
  evidenceConflicts?: string[];
};

export type UpsertAgencyContactInput = {
  /** Influencer that owns the InfluencerAgency association (eligibility source of truth). */
  influencerId: string;
  agencyId: string;
  /** Normalized Agency.domain — required for RF-01 gate. */
  agencyDomain: string;
  email: string;
  sourceUrl: string;
  evidenceSnippet: string;
  /** Alternate corroborated hosts (regional / parent), never brandCandidate domains. */
  corroboratedDomains?: string[];
  contactKind?: AgencyContactKind;
  displayName?: string | null;
  title?: string | null;
  label?: string | null;
  isGeneric?: boolean;
  commercialRelevance?: CommercialRelevance;
  outreachRole?: string;
  sourceKind?: string;
  /**
   * @deprecated Ignored — eligibility always loads InfluencerAgency.relevanceStatus
   * from Prisma (2C.4.3.1). Kept optional only to avoid silent breakage of early callers.
   */
  relevanceStatus?: AgencyRelevanceStatus | string | null;
};

export type UpsertAgencyContactResult = {
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

function snippetQuality(snippet: string): number {
  return snippet.trim().length;
}

/**
 * 2C.4.3 — Nest persistence for AgencyContact (never BBC / Lead / ContactChannel).
 */
@Injectable()
export class AgencyContactPersistenceService {
  private readonly logger = new Logger(AgencyContactPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsertFromDiscovery(
    input: UpsertAgencyContactInput,
  ): Promise<UpsertAgencyContactResult> {
    const eligibility = await this.assertPersistedEligibility(
      input.influencerId,
      input.agencyId,
    );
    if (eligibility) {
      return eligibility;
    }

    const emailNormalized = normalizeBusinessEmail(input.email);
    if (!emailNormalized.includes('@')) {
      return {
        id: null,
        created: false,
        updated: false,
        skipped: true,
        skipReason: 'domain_invalid',
      };
    }

    const assessment = assessAgencyContactEmailDomain(
      emailNormalized,
      input.agencyDomain,
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
    const outreachRole =
      input.outreachRole ?? outreachRoleFromEmailLocalPart(emailNormalized);

    // Never invent a person from local-part alone.
    let contactKind = input.contactKind ?? AgencyContactKind.MAILBOX;
    if (
      contactKind === AgencyContactKind.PERSON &&
      (!input.displayName?.trim() || isGeneric)
    ) {
      contactKind = AgencyContactKind.MAILBOX;
    }

    const evidence: AgencyContactEvidence = {
      sourceUrl: input.sourceUrl,
      evidenceSnippet: input.evidenceSnippet,
      discoveredAt: new Date().toISOString(),
    };

    const provenanceBase: AgencyContactProvenanceMetadata = {
      evidences: [evidence],
      discoveryStatus: CONTACT_EMAIL_DISCOVERY_STATUS.FOUND,
      attributionStatus: CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED,
      verificationStatus: CONTACT_EMAIL_VERIFICATION_STATUS.UNVERIFIED,
      domainAssessmentReason: assessment.reason,
      ...(outreachRole ? { outreachRole } : {}),
      ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
    };

    try {
      const existing = await this.prisma.agencyContact.findUnique({
        where: {
          agencyId_emailNormalized: {
            agencyId: input.agencyId,
            emailNormalized,
          },
        },
      });

      if (!existing) {
        const created = await this.prisma.agencyContact.create({
          data: {
            agencyId: input.agencyId,
            email: emailNormalized,
            emailNormalized,
            label,
            displayName:
              contactKind === AgencyContactKind.PERSON
                ? (input.displayName?.trim() ?? null)
                : null,
            title:
              contactKind === AgencyContactKind.PERSON
                ? (input.title?.trim() ?? null)
                : null,
            contactKind,
            isGeneric,
            commercialRelevance,
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

      const previous = this.readProvenance(existing.metadata);
      const { evidences: mergedEvidences, conflicts } = this.mergeEvidences(
        existing.metadata,
        evidence,
      );

      const nextRelevance = pickStrongerRelevance(
        existing.commercialRelevance,
        commercialRelevance,
      );

      // PERSON is sticky: never downgrade to MAILBOX on a generic mailbox observation.
      const nextKind =
        existing.contactKind === AgencyContactKind.PERSON
          ? AgencyContactKind.PERSON
          : contactKind;

      // Do not replace evidenced displayName with a weaker/inferred value.
      let nextDisplayName = existing.displayName;
      let nextTitle = existing.title;
      if (nextKind === AgencyContactKind.PERSON) {
        const incomingName = input.displayName?.trim();
        if (incomingName) {
          if (!existing.displayName) {
            nextDisplayName = incomingName;
          } else if (
            incomingName.toLowerCase() !== existing.displayName.toLowerCase()
          ) {
            conflicts.push(
              `displayName_conflict:${existing.displayName}|${incomingName}`,
            );
          }
        }
        const incomingTitle = input.title?.trim();
        if (incomingTitle && !existing.title) {
          nextTitle = incomingTitle;
        }
      }

      // isGeneric: once PERSON, keep person-ish flags; otherwise OR of generics.
      const nextIsGeneric =
        nextKind === AgencyContactKind.PERSON
          ? false
          : existing.isGeneric || isGeneric;

      const nextAttribution =
        previous.attributionStatus ===
          CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED ||
        assessment.decision === 'allow'
          ? CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED
          : previous.attributionStatus;

      // Never invent VERIFIED; preserve only if a future real verify wrote it.
      const nextVerification =
        previous.verificationStatus ===
        CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
          ? CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
          : CONTACT_EMAIL_VERIFICATION_STATUS.UNVERIFIED;

      const priorOutreach =
        typeof previous.outreachRole === 'string'
          ? previous.outreachRole
          : undefined;
      const nextOutreach = priorOutreach ?? outreachRole;

      const mergedProvenance: AgencyContactProvenanceMetadata = {
        evidences: mergedEvidences,
        discoveryStatus: CONTACT_EMAIL_DISCOVERY_STATUS.FOUND,
        attributionStatus: nextAttribution,
        verificationStatus: nextVerification,
        domainAssessmentReason: assessment.reason,
        ...(nextOutreach ? { outreachRole: nextOutreach } : {}),
        ...(input.sourceKind || previous.sourceKind
          ? { sourceKind: input.sourceKind ?? previous.sourceKind }
          : {}),
        ...(conflicts.length
          ? {
              evidenceConflicts: [
                ...(previous.evidenceConflicts ?? []),
                ...conflicts,
              ].slice(0, 20),
            }
          : previous.evidenceConflicts?.length
            ? { evidenceConflicts: previous.evidenceConflicts }
            : {}),
      };

      await this.prisma.agencyContact.update({
        where: { id: existing.id },
        data: {
          commercialRelevance: nextRelevance,
          isGeneric: nextIsGeneric,
          contactKind: nextKind,
          label: existing.label || label,
          displayName: nextDisplayName,
          title: nextTitle,
          metadata: mergedProvenance as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        id: existing.id,
        created: false,
        updated: true,
        skipped: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          event: 'agency_contact_persist_failed',
          agencyId: input.agencyId,
          emailNormalized,
          errorMessage: message.slice(0, 500),
        }),
      );
      return {
        id: null,
        created: false,
        updated: false,
        skipped: true,
        skipReason: `persist_failed:${message.slice(0, 200)}`,
      };
    }
  }

  /**
   * 2C.4.3.1 — eligibility from persisted InfluencerAgency only.
   * input.relevanceStatus is never authoritative.
   */
  private async assertPersistedEligibility(
    influencerId: string,
    agencyId: string,
  ): Promise<UpsertAgencyContactResult | null> {
    if (!influencerId?.trim() || !agencyId?.trim()) {
      return {
        id: null,
        created: false,
        updated: false,
        skipped: true,
        skipReason: 'association_missing',
      };
    }

    try {
      const association = await this.prisma.influencerAgency.findUnique({
        where: {
          influencerId_agencyId: {
            influencerId,
            agencyId,
          },
        },
        select: { relevanceStatus: true },
      });

      if (!association) {
        return {
          id: null,
          created: false,
          updated: false,
          skipped: true,
          skipReason: 'association_missing',
        };
      }

      if (!isAgencyEligibleForContactResearch(association.relevanceStatus)) {
        return {
          id: null,
          created: false,
          updated: false,
          skipped: true,
          skipReason:
            agencyContactEligibilitySkipReason(association.relevanceStatus) ??
            'relevance_unknown',
        };
      }

      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          event: 'agency_contact_eligibility_lookup_failed',
          influencerId,
          agencyId,
          errorMessage: message.slice(0, 500),
        }),
      );
      return {
        id: null,
        created: false,
        updated: false,
        skipped: true,
        skipReason: `eligibility_lookup_failed:${message.slice(0, 200)}`,
      };
    }
  }

  private mergeEvidences(
    metadata: unknown,
    incoming: AgencyContactEvidence,
  ): { evidences: AgencyContactEvidence[]; conflicts: string[] } {
    const conflicts: string[] = [];
    const existing = this.readEvidences(metadata);
    const byUrl = new Map<string, AgencyContactEvidence>();
    for (const item of existing) {
      byUrl.set(item.sourceUrl.toLowerCase(), item);
    }
    const key = incoming.sourceUrl.toLowerCase();
    const prior = byUrl.get(key);
    if (!prior) {
      byUrl.set(key, incoming);
    } else if (
      snippetQuality(incoming.evidenceSnippet) >
      snippetQuality(prior.evidenceSnippet)
    ) {
      byUrl.set(key, {
        ...prior,
        evidenceSnippet: incoming.evidenceSnippet,
      });
    } else if (
      incoming.evidenceSnippet.trim() &&
      incoming.evidenceSnippet !== prior.evidenceSnippet &&
      snippetQuality(incoming.evidenceSnippet) <
        snippetQuality(prior.evidenceSnippet)
    ) {
      // Keep stronger prior; record that a weaker duplicate arrived.
      conflicts.push(`weaker_snippet_ignored:${key}`);
    }
    return { evidences: [...byUrl.values()], conflicts };
  }

  private readProvenance(metadata: unknown): AgencyContactProvenanceMetadata {
    const evidences = this.readEvidences(metadata);
    const raw =
      metadata && typeof metadata === 'object'
        ? (metadata as Record<string, unknown>)
        : {};

    const attributionStatus =
      raw.attributionStatus === CONTACT_EMAIL_ATTRIBUTION_STATUS.UNATTRIBUTED
        ? CONTACT_EMAIL_ATTRIBUTION_STATUS.UNATTRIBUTED
        : CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED;

    const verificationStatus =
      raw.verificationStatus === CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
        ? CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
        : CONTACT_EMAIL_VERIFICATION_STATUS.UNVERIFIED;

    const evidenceConflicts = Array.isArray(raw.evidenceConflicts)
      ? raw.evidenceConflicts.filter((v): v is string => typeof v === 'string')
      : undefined;

    return {
      evidences,
      discoveryStatus: CONTACT_EMAIL_DISCOVERY_STATUS.FOUND,
      attributionStatus:
        raw.attributionStatus == null
          ? CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED
          : attributionStatus,
      verificationStatus,
      domainAssessmentReason:
        typeof raw.domainAssessmentReason === 'string'
          ? raw.domainAssessmentReason
          : undefined,
      outreachRole:
        typeof raw.outreachRole === 'string' ? raw.outreachRole : undefined,
      sourceKind:
        typeof raw.sourceKind === 'string' ? raw.sourceKind : undefined,
      ...(evidenceConflicts?.length ? { evidenceConflicts } : {}),
    };
  }

  private readEvidences(metadata: unknown): AgencyContactEvidence[] {
    if (!metadata || typeof metadata !== 'object') {
      return [];
    }
    const evidences = (metadata as { evidences?: unknown }).evidences;
    if (!Array.isArray(evidences)) {
      return [];
    }
    return evidences.filter(
      (item): item is AgencyContactEvidence =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as AgencyContactEvidence).sourceUrl === 'string' &&
        typeof (item as AgencyContactEvidence).evidenceSnippet === 'string',
    );
  }
}
