/**
 * BullMQ payload for Instagram research jobs on queue `instagram-research`.
 */
export type InstagramResearchJobData = {
  runId: string;
};

/** Stable jobId so duplicate enqueue of the same run is rejected by BullMQ. */
export function instagramResearchJobId(runId: string): string {
  return `ig-research-${runId}`;
}
