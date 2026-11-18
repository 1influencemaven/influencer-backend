import { AgencyRelevanceStatus } from '../../generated/prisma/enums';

/**
 * 2C.4.3 — Nest-owned eligibility for Agency Contact Research.
 * Product rule: RELEVANT | UNDER_REVIEW only.
 * Never trust Mastra/FE to decide eligibility.
 */
export const AGENCY_CONTACT_ELIGIBLE_RELEVANCE = [
  AgencyRelevanceStatus.RELEVANT,
  AgencyRelevanceStatus.UNDER_REVIEW,
] as const;

export type AgencyContactEligibleRelevance =
  (typeof AGENCY_CONTACT_ELIGIBLE_RELEVANCE)[number];

export function isAgencyEligibleForContactResearch(
  relevanceStatus: AgencyRelevanceStatus | string | null | undefined,
): boolean {
  return (
    relevanceStatus === AgencyRelevanceStatus.RELEVANT ||
    relevanceStatus === AgencyRelevanceStatus.UNDER_REVIEW
  );
}

export function agencyContactEligibilitySkipReason(
  relevanceStatus: AgencyRelevanceStatus | string | null | undefined,
): string | null {
  if (isAgencyEligibleForContactResearch(relevanceStatus)) {
    return null;
  }
  if (relevanceStatus === AgencyRelevanceStatus.NOT_RELEVANT) {
    return 'relevance_not_relevant';
  }
  if (relevanceStatus === AgencyRelevanceStatus.DISCARDED) {
    return 'relevance_discarded';
  }
  return 'relevance_unknown';
}
