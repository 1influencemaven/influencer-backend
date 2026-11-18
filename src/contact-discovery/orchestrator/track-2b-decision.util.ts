/**
 * RF-03: conditional Track 2B after Track 2A commercial coverage.
 * Uses functional commercialCoverageTier flags from this-run persisted BBCs
 * (RF-01 gates already applied). HIGH/MEDIUM ⇒ skip 2B.
 */

export type Track2BDecisionReason =
  | 'SUFFICIENT_COMMERCIAL_COVERAGE_HIGH'
  | 'SUFFICIENT_COMMERCIAL_COVERAGE_MEDIUM'
  | 'SUFFICIENT_COMMERCIAL_COVERAGE_HIGH_AND_MEDIUM'
  | 'INSUFFICIENT_COMMERCIAL_COVERAGE'
  | 'NO_COMMERCIAL_EMAILS_FROM_2A';

export type Track2BDecision = {
  shouldRun: boolean;
  reason: Track2BDecisionReason;
  hasHigh: boolean;
  hasMedium: boolean;
};

/**
 * `runTrack2B = !hasHigh && !hasMedium`
 * Coverage flags must come only from emails persisted in the current 2A run.
 */
export function decideTrack2BExecution(coverage: {
  hasHigh: boolean;
  hasMedium: boolean;
  /** Created + updated BBCs in this 2A run (not historical). */
  emailsPersistedThisRun: number;
}): Track2BDecision {
  const hasHigh = coverage.hasHigh === true;
  const hasMedium = coverage.hasMedium === true;

  if (hasHigh && hasMedium) {
    return {
      shouldRun: false,
      reason: 'SUFFICIENT_COMMERCIAL_COVERAGE_HIGH_AND_MEDIUM',
      hasHigh,
      hasMedium,
    };
  }
  if (hasHigh) {
    return {
      shouldRun: false,
      reason: 'SUFFICIENT_COMMERCIAL_COVERAGE_HIGH',
      hasHigh,
      hasMedium,
    };
  }
  if (hasMedium) {
    return {
      shouldRun: false,
      reason: 'SUFFICIENT_COMMERCIAL_COVERAGE_MEDIUM',
      hasHigh,
      hasMedium,
    };
  }
  if (coverage.emailsPersistedThisRun <= 0) {
    return {
      shouldRun: true,
      reason: 'NO_COMMERCIAL_EMAILS_FROM_2A',
      hasHigh,
      hasMedium,
    };
  }
  return {
    shouldRun: true,
    reason: 'INSUFFICIENT_COMMERCIAL_COVERAGE',
    hasHigh,
    hasMedium,
  };
}
