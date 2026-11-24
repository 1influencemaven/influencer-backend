/**
 * RF-03 (v2, enrichment strategy): Track 2B (Bright Data LinkedIn people) runs
 * unless the run already holds a verified nominal email (Tier 1, e.g. from
 * Saleshandy). Area mailboxes (HIGH/MEDIUM) are Tier 2 and no longer skip 2B:
 * a named decision-maker always beats `partnerships@`.
 */

export type Track2BDecisionReason =
  | 'TIER1_NOMINAL_FOUND'
  | 'MAILBOX_ONLY_HIGH'
  | 'MAILBOX_ONLY_MEDIUM'
  | 'MAILBOX_ONLY_HIGH_AND_MEDIUM'
  | 'INSUFFICIENT_COMMERCIAL_COVERAGE'
  | 'NO_COMMERCIAL_EMAILS_FROM_2A';

export type Track2BDecision = {
  shouldRun: boolean;
  reason: Track2BDecisionReason;
  hasHigh: boolean;
  hasMedium: boolean;
};

/** `runTrack2B = !hasTier1Nominal`; mailbox flags only explain the reason. */
export function decideTrack2BExecution(coverage: {
  hasHigh: boolean;
  hasMedium: boolean;
  /** Created + updated BBCs in this 2A run (not historical). */
  emailsPersistedThisRun: number;
  /** Verified person email already found in this run (Saleshandy / reuse). */
  hasTier1Nominal?: boolean;
}): Track2BDecision {
  const hasHigh = coverage.hasHigh === true;
  const hasMedium = coverage.hasMedium === true;
  const base = { hasHigh, hasMedium };

  if (coverage.hasTier1Nominal === true) {
    return { shouldRun: false, reason: 'TIER1_NOMINAL_FOUND', ...base };
  }
  if (hasHigh && hasMedium) {
    return { shouldRun: true, reason: 'MAILBOX_ONLY_HIGH_AND_MEDIUM', ...base };
  }
  if (hasHigh) {
    return { shouldRun: true, reason: 'MAILBOX_ONLY_HIGH', ...base };
  }
  if (hasMedium) {
    return { shouldRun: true, reason: 'MAILBOX_ONLY_MEDIUM', ...base };
  }
  if (coverage.emailsPersistedThisRun <= 0) {
    return { shouldRun: true, reason: 'NO_COMMERCIAL_EMAILS_FROM_2A', ...base };
  }
  return { shouldRun: true, reason: 'INSUFFICIENT_COMMERCIAL_COVERAGE', ...base };
}
