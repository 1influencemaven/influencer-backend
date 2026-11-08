import {
  parseAiExecutionResult,
  type AiExecutionResult,
} from '@influence-maven/ai-contracts';
import type { Job, Queue } from 'bullmq';

import {
  AI_EXECUTION_WAIT_ERROR_CODES,
  AiExecutionWaitError,
} from './ai-execution-result-wait.errors';

/** BullMQ jobId used by influencer-ai `publishResult` (colon forbidden). */
export function aiExecutionResultJobId(executionId: string): string {
  return `result-${executionId}`;
}

export type WaitForAiExecutionResultOptions = {
  /** Poll cadence while waiting (default 100ms). */
  pollIntervalMs?: number;
  /** Injectable clock for unit tests. */
  now?: () => number;
  /** Injectable sleep for unit tests (avoid real delays). */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_POLL_INTERVAL_MS = 100;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readResultFromJob(
  job: Job,
  expectedExecutionId: string,
): AiExecutionResult {
  let parsed: AiExecutionResult;
  try {
    parsed = parseAiExecutionResult(job.data);
  } catch (error) {
    throw new AiExecutionWaitError(
      AI_EXECUTION_WAIT_ERROR_CODES.INVALID_RESULT,
      `AiExecutionResult failed contract validation for executionId=${expectedExecutionId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      expectedExecutionId,
      error,
    );
  }

  if (parsed.executionId !== expectedExecutionId) {
    throw new AiExecutionWaitError(
      AI_EXECUTION_WAIT_ERROR_CODES.CORRELATION_MISMATCH,
      `Result executionId=${parsed.executionId} does not match expected=${expectedExecutionId}`,
      expectedExecutionId,
    );
  }

  return parsed;
}

async function getResultJob(
  resultsQueue: Queue,
  executionId: string,
): Promise<Job | null> {
  try {
    const job = await resultsQueue.getJob(aiExecutionResultJobId(executionId));
    return job ?? null;
  } catch (error) {
    throw new AiExecutionWaitError(
      AI_EXECUTION_WAIT_ERROR_CODES.INFRASTRUCTURE,
      `BullMQ/Redis error while reading result for executionId=${executionId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      executionId,
      error,
    );
  }
}

/**
 * Waits for a Mastra result previously published to `ai.execution.results`
 * under jobId `result-{executionId}`.
 *
 * - Does not subscribe to QueueEvents (avoids missing early completions).
 * - Polls `Queue.getJob` so a result published before the wait still resolves.
 * - Returns COMPLETED and FAILED payloads; does not throw on worker FAILED.
 * - Does not remove or mutate other jobs.
 *
 * `timeoutMs === 0`: single lookup; missing job → NOT_FOUND.
 * `timeoutMs > 0`: poll until deadline; still missing → TIMEOUT.
 */
export async function waitForAiExecutionResult(
  resultsQueue: Queue,
  executionId: string,
  timeoutMs: number,
  options: WaitForAiExecutionResultOptions = {},
): Promise<AiExecutionResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new AiExecutionWaitError(
      AI_EXECUTION_WAIT_ERROR_CODES.INVALID_RESULT,
      `timeoutMs must be a non-negative finite number (got ${timeoutMs})`,
      executionId,
    );
  }

  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = now() + timeoutMs;

  const initial = await getResultJob(resultsQueue, executionId);
  if (initial) {
    return readResultFromJob(initial, executionId);
  }

  if (timeoutMs === 0) {
    throw new AiExecutionWaitError(
      AI_EXECUTION_WAIT_ERROR_CODES.NOT_FOUND,
      `No ai.execution.results job for executionId=${executionId}`,
      executionId,
    );
  }

  while (now() < deadline) {
    const remaining = deadline - now();
    await sleep(Math.min(pollIntervalMs, Math.max(remaining, 0)));

    const job = await getResultJob(resultsQueue, executionId);
    if (job) {
      return readResultFromJob(job, executionId);
    }
  }

  throw new AiExecutionWaitError(
    AI_EXECUTION_WAIT_ERROR_CODES.TIMEOUT,
    `Timed out after ${timeoutMs}ms waiting for ai.execution.results job result-${executionId}`,
    executionId,
  );
}
