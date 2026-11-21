import {
  AgencyContactKind,
  AgencyRelevanceStatus,
  CommercialRelevance,
} from '../../generated/prisma/enums';

/**
 * Commercial visibility for AgencyContact list (2C.4.7).
 * Orthogonal to InfluencerAgency.relevanceStatus.
 */
export type AgencyContactCommercialEligibilityStatus =
  | 'ACTIONABLE'
  | 'VISIBLE_NOT_ACTIONABLE'
  | 'VISIBLE_NOT_PRIORITY';

export type AgencyContactCommercialEligibility = {
  include: boolean;
  status?: AgencyContactCommercialEligibilityStatus;
  reason: string;
  /** HIGH contacts under a RELEVANT agency. */
  priority: boolean;
};

const VISIBLE_AGENCY: ReadonlySet<AgencyRelevanceStatus> = new Set([
  AgencyRelevanceStatus.RELEVANT,
  AgencyRelevanceStatus.UNDER_REVIEW,
]);

const VISIBLE_COMMERCIAL: ReadonlySet<CommercialRelevance> = new Set([
  CommercialRelevance.HIGH,
  CommercialRelevance.NEUTRAL,
  CommercialRelevance.UNKNOWN,
]);

/**
 * Agency gate + commercialRelevance gate for read-only commercial listing.
 * Does not invent RF-01 statuses; does not treat agency relevance as contact relevance.
 */
export function assessAgencyContactCommercialEligibility(params: {
  agencyRelevanceStatus: AgencyRelevanceStatus;
  commercialRelevance: CommercialRelevance;
}): AgencyContactCommercialEligibility {
  const { agencyRelevanceStatus, commercialRelevance } = params;

  if (!VISIBLE_AGENCY.has(agencyRelevanceStatus)) {
    return {
      include: false,
      reason: `agency_${agencyRelevanceStatus.toLowerCase()}`,
      priority: false,
    };
  }

  if (commercialRelevance === CommercialRelevance.LOW) {
    return {
      include: false,
      reason: 'commercial_low',
      priority: false,
    };
  }

  if (!VISIBLE_COMMERCIAL.has(commercialRelevance)) {
    return {
      include: false,
      reason: 'commercial_excluded',
      priority: false,
    };
  }

  if (agencyRelevanceStatus === AgencyRelevanceStatus.UNDER_REVIEW) {
    return {
      include: true,
      status: 'VISIBLE_NOT_ACTIONABLE',
      reason: 'agency_under_review',
      priority: false,
    };
  }

  // RELEVANT agency
  if (commercialRelevance === CommercialRelevance.UNKNOWN) {
    return {
      include: true,
      status: 'VISIBLE_NOT_PRIORITY',
      reason: 'commercial_unknown_general',
      priority: false,
    };
  }

  return {
    include: true,
    status: 'ACTIONABLE',
    reason:
      commercialRelevance === CommercialRelevance.HIGH
        ? 'relevant_high'
        : 'relevant_neutral',
    priority: commercialRelevance === CommercialRelevance.HIGH,
  };
}

/**
 * Infer research operation from persisted shape without inventing sourceKind.
 * PERSON → FIND_AGENCY_PEOPLE; MAILBOX → FIND_AGENCY_EMAILS.
 * sourceKind linkedin/ocr reinforces people; agency_web alone does not override kind.
 */
export function inferAgencyContactResearchOperation(params: {
  contactKind: AgencyContactKind;
  sourceKind?: string | null;
}): 'FIND_AGENCY_EMAILS' | 'FIND_AGENCY_PEOPLE' {
  if (params.contactKind === AgencyContactKind.PERSON) {
    return 'FIND_AGENCY_PEOPLE';
  }
  const sk = params.sourceKind?.trim().toLowerCase();
  if (sk === 'linkedin' || sk === 'ocr') {
    return 'FIND_AGENCY_PEOPLE';
  }
  return 'FIND_AGENCY_EMAILS';
}
