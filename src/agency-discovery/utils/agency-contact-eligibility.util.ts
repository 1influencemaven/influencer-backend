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

/** Agencies researched in parallel per Track 2C pass (emails, then people). */
export const AGENCY_RESEARCH_CONCURRENCY = 3;

const RELEVANCE_PRIORITY: Record<string, number> = {
  RELEVANT: 0,
  UNDER_REVIEW: 1,
};

/**
 * Stable sort: RELEVANT agencies before UNDER_REVIEW, keeping the incoming
 * (most recently updated first) order inside each group.
 */
export function rankAgencyAssociations<T extends { relevanceStatus: string }>(
  rows: readonly T[],
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        (RELEVANCE_PRIORITY[a.row.relevanceStatus] ?? 9) -
          (RELEVANCE_PRIORITY[b.row.relevanceStatus] ?? 9) || a.index - b.index,
    )
    .map(({ row }) => row);
}
