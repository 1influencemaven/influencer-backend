/**
 * RF-04.1 / RF-04.1.1: Nest orchestrator performance timings for Contact Research.
 * Additive on searchMetadata; historical runs simply omit `timings`.
 *
 * - wait*Ms: Nest wall time waiting for the AI result job (not worker duration).
 * - aiDuration*Ms: AiExecutionResult.durationMs from Mastra (propagated, not recomputed).
 * - Track 2B wait/duration fields are present only when the Nest wait actually ran.
 *   Omitted when RF-03 skips 2B, or when 2B publish fails before wait starts.
 *   Never invent wait2BMs: 0 for a wait that did not occur.
 */

export type ContactResearchTimings = {
  wait2AMs: number;
  /** null when 2A result had no usable durationMs. */
  aiDuration2AMs: number | null;
  /** Present only when Track 2B wait was started and measured. */
  wait2BMs?: number;
  /**
   * Present only when Track 2B wait was started.
   * null = wait ran but Mastra durationMs unavailable.
   */
  aiDuration2BMs?: number | null;
  totalOrchestratorMs: number;
};

export type OrchestratorClock = {
  /** Monotonic-friendly clock (e.g. performance.now). */
  now: () => number;
};

export const defaultOrchestratorClock: OrchestratorClock = {
  now: () => performance.now(),
};

/** Propagate Mastra duration as-is; never invent a value. */
export function readAiDurationMs(result: {
  durationMs?: unknown;
}): number | null {
  return typeof result.durationMs === 'number' &&
    Number.isFinite(result.durationMs) &&
    result.durationMs >= 0
    ? result.durationMs
    : null;
}

export function buildContactResearchTimings(params: {
  wait2AMs: number;
  aiDuration2AMs: number | null;
  totalOrchestratorMs: number;
  /**
   * Include only when Nest actually started waiting for the 2B result.
   * Do not pass a stub with wait2BMs: 0 for publish-before-wait failures.
   */
  track2BWait?: {
    wait2BMs: number;
    aiDuration2BMs: number | null;
  };
}): ContactResearchTimings {
  const timings: ContactResearchTimings = {
    wait2AMs: Math.max(0, Math.round(params.wait2AMs)),
    aiDuration2AMs: params.aiDuration2AMs,
    totalOrchestratorMs: Math.max(0, Math.round(params.totalOrchestratorMs)),
  };
  if (params.track2BWait) {
    timings.wait2BMs = Math.max(0, Math.round(params.track2BWait.wait2BMs));
    timings.aiDuration2BMs = params.track2BWait.aiDuration2BMs;
  }
  return timings;
}
