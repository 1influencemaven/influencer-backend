import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AgencyContactKind,
  AgencyRelevanceStatus,
  CommercialRelevance,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  CONTACT_EMAIL_ATTRIBUTION_STATUS,
  CONTACT_EMAIL_DISCOVERY_STATUS,
  CONTACT_EMAIL_VERIFICATION_STATUS,
  type ContactEmailAttributionStatus,
  type ContactEmailDiscoveryStatus,
  type ContactEmailVerificationStatus,
} from '../lead-discovery/utils/contact-email-attribution.util';
import type { AgencyContactEvidence } from './agency-contact-persistence.service';
import {
  assessAgencyContactCommercialEligibility,
  inferAgencyContactResearchOperation,
  type AgencyContactCommercialEligibilityStatus,
} from './utils/agency-contact-commercial-eligibility.util';

export type AgencyContactCommercialListFilters = {
  influencerId: string;
  contactKind?: AgencyContactKind;
  commercialRelevance?: CommercialRelevance;
};

export type AgencyContactCommercialItem = {
  agencyId: string;
  agencyName: string;
  agencyDomain: string;
  agencyRelevanceStatus: AgencyRelevanceStatus;
  agencyContactId: string;
  contactKind: AgencyContactKind;
  email: string;
  displayName: string | null;
  title: string | null;
  label: string | null;
  isGeneric: boolean;
  commercialRelevance: CommercialRelevance;
  sourceKind: string | null;
  /** RF-01 projection (not raw AgencyContact.metadata). */
  provenance: {
    discoveryStatus: ContactEmailDiscoveryStatus;
    attributionStatus: ContactEmailAttributionStatus;
    verificationStatus: ContactEmailVerificationStatus;
  };
  attributionStatus: ContactEmailAttributionStatus;
  evidence: AgencyContactEvidence[];
  outreachRole: string | null;
  discoveredAt: Date;
  eligibilityStatus: AgencyContactCommercialEligibilityStatus;
  eligibilityReason: string;
  priority: boolean;
  origin: 'AGENCY_CONTACT_RESEARCH';
  track: '2C';
  researchOperation: 'FIND_AGENCY_EMAILS' | 'FIND_AGENCY_PEOPLE';
};

type ProvenanceProjection = {
  evidences: AgencyContactEvidence[];
  discoveryStatus: ContactEmailDiscoveryStatus;
  attributionStatus: ContactEmailAttributionStatus;
  verificationStatus: ContactEmailVerificationStatus;
  outreachRole: string | null;
  sourceKind: string | null;
};

/**
 * 2C.4.7 — Read-only commercial adapter over AgencyContact.
 * Never writes Lead/ContactChannel/BBC; never triggers Mastra/Bright Data.
 */
@Injectable()
export class AgencyContactCommercialReaderService {
  constructor(private readonly prisma: PrismaService) {}

  async listForInfluencer(
    filters: AgencyContactCommercialListFilters,
  ): Promise<AgencyContactCommercialItem[]> {
    const influencer = await this.prisma.influencer.findUnique({
      where: { id: filters.influencerId },
      select: { id: true },
    });
    if (!influencer) {
      throw new NotFoundException(
        `Influencer ${filters.influencerId} not found`,
      );
    }

    const associations = await this.prisma.influencerAgency.findMany({
      where: {
        influencerId: filters.influencerId,
        relevanceStatus: {
          in: [
            AgencyRelevanceStatus.RELEVANT,
            AgencyRelevanceStatus.UNDER_REVIEW,
          ],
        },
      },
      select: {
        relevanceStatus: true,
        agency: {
          select: {
            id: true,
            name: true,
            domain: true,
            contacts: {
              where: {
                ...(filters.contactKind
                  ? { contactKind: filters.contactKind }
                  : {}),
                ...(filters.commercialRelevance
                  ? { commercialRelevance: filters.commercialRelevance }
                  : {
                      commercialRelevance: {
                        in: [
                          CommercialRelevance.HIGH,
                          CommercialRelevance.NEUTRAL,
                          CommercialRelevance.UNKNOWN,
                        ],
                      },
                    }),
              },
              orderBy: { discoveredAt: 'desc' },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const items: AgencyContactCommercialItem[] = [];

    for (const row of associations) {
      const agency = row.agency;
      for (const contact of agency.contacts) {
        const eligibility = assessAgencyContactCommercialEligibility({
          agencyRelevanceStatus: row.relevanceStatus,
          commercialRelevance: contact.commercialRelevance,
        });
        if (!eligibility.include || !eligibility.status) {
          continue;
        }

        const provenance = this.projectProvenance(contact.metadata);
        const researchOperation = inferAgencyContactResearchOperation({
          contactKind: contact.contactKind,
          sourceKind: provenance.sourceKind,
        });

        items.push({
          agencyId: agency.id,
          agencyName: agency.name,
          agencyDomain: agency.domain,
          agencyRelevanceStatus: row.relevanceStatus,
          agencyContactId: contact.id,
          contactKind: contact.contactKind,
          email: contact.email,
          displayName: contact.displayName,
          title: contact.title,
          label: contact.label,
          isGeneric: contact.isGeneric,
          commercialRelevance: contact.commercialRelevance,
          sourceKind: provenance.sourceKind,
          provenance: {
            discoveryStatus: provenance.discoveryStatus,
            attributionStatus: provenance.attributionStatus,
            verificationStatus: provenance.verificationStatus,
          },
          attributionStatus: provenance.attributionStatus,
          evidence: provenance.evidences,
          outreachRole: provenance.outreachRole,
          discoveredAt: contact.discoveredAt,
          eligibilityStatus: eligibility.status,
          eligibilityReason: eligibility.reason,
          priority: eligibility.priority,
          origin: 'AGENCY_CONTACT_RESEARCH',
          track: '2C',
          researchOperation,
        });
      }
    }

    return items.sort((a, b) => {
      const rank =
        this.sortRank(b) - this.sortRank(a) ||
        b.discoveredAt.getTime() - a.discoveredAt.getTime();
      return rank;
    });
  }

  private sortRank(item: AgencyContactCommercialItem): number {
    if (item.eligibilityStatus === 'ACTIONABLE' && item.priority) return 4;
    if (item.eligibilityStatus === 'ACTIONABLE') return 3;
    if (item.eligibilityStatus === 'VISIBLE_NOT_PRIORITY') return 2;
    return 1;
  }

  /**
   * Project RF-01 fields only. Never invent VERIFIED — unknown/missing → UNVERIFIED.
   * If metadata literally stores VERIFIED (should not happen), surface as UNVERIFIED
   * unless we can prove a real verifier existed — product rule: do not invent VERIFIED,
   * so we only pass through VERIFIED if present (honest read) … Spec says "No se inventa
   * VERIFIED" and "UNVERIFIED conserva su estado". Pass-through of stored value is OK;
   * default missing to UNVERIFIED.
   */
  private projectProvenance(metadata: unknown): ProvenanceProjection {
    const raw =
      metadata && typeof metadata === 'object'
        ? (metadata as Record<string, unknown>)
        : {};

    const evidences = Array.isArray(raw.evidences)
      ? raw.evidences.filter(
          (item): item is AgencyContactEvidence =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as AgencyContactEvidence).sourceUrl === 'string' &&
            typeof (item as AgencyContactEvidence).evidenceSnippet === 'string',
        )
      : [];

    const attributionStatus =
      raw.attributionStatus === CONTACT_EMAIL_ATTRIBUTION_STATUS.UNATTRIBUTED
        ? CONTACT_EMAIL_ATTRIBUTION_STATUS.UNATTRIBUTED
        : raw.attributionStatus === CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED
          ? CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED
          : CONTACT_EMAIL_ATTRIBUTION_STATUS.ATTRIBUTED;

    // Never invent VERIFIED: only emit VERIFIED if metadata already has it;
    // otherwise UNVERIFIED. Reader does not upgrade status.
    const verificationStatus =
      raw.verificationStatus === CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
        ? CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED
        : CONTACT_EMAIL_VERIFICATION_STATUS.UNVERIFIED;

    return {
      evidences,
      discoveryStatus: CONTACT_EMAIL_DISCOVERY_STATUS.FOUND,
      attributionStatus,
      verificationStatus,
      outreachRole:
        typeof raw.outreachRole === 'string' ? raw.outreachRole : null,
      sourceKind: typeof raw.sourceKind === 'string' ? raw.sourceKind : null,
    };
  }
}
