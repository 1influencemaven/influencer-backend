/**
 * BullMQ payload for `discover-business-contacts` on queue `contact-discovery`.
 * Search Unlocker is NOT used in BBC v1 allowlist-HTML path (T4).
 */
export type DiscoverBusinessContactsJobData = {
  runId: string;
  brandCandidateId: string;
  influencerId: string;
  website: string;
  domain: string;
  maxPages?: number;
  /** Snapshot of Settings Lead Discovery instructions taken at enqueue time (optional for backward compat). */
  promptInstructions?: string;
};

/** Stable jobId so duplicate enqueue of the same run is rejected by BullMQ. */
export function contactDiscoveryJobId(runId: string): string {
  return `bbc-run-${runId}`;
}
