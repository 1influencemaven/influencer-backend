import { randomUUID } from 'node:crypto';

import {
  AI_CONTRACT_VERSION,
  type AiExecutionEvent,
  type AiExecutionRequest,
  type AiExecutionResult,
} from '@influence-maven/ai-contracts';
import type { Queue } from 'bullmq';

import { AI_EXECUTION_JOBS } from '../queues';

export async function publishResult(
  resultsQueue: Queue,
  result: AiExecutionResult,
): Promise<void> {
  await resultsQueue.add(AI_EXECUTION_JOBS.RESULT, result, {
    // BullMQ custom ids cannot contain ':'
    jobId: `result-${result.executionId}`,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

export async function publishEvent(
  eventsQueue: Queue,
  event: AiExecutionEvent,
): Promise<void> {
  await eventsQueue.add(AI_EXECUTION_JOBS.EVENT, event, {
    jobId: `event-${event.eventId}`,
    removeOnComplete: 2000,
    removeOnFail: 5000,
  });
}

export function buildEvent(
  request: AiExecutionRequest,
  sequence: number,
  name: AiExecutionEvent['name'],
  payload: AiExecutionEvent['payload'],
): AiExecutionEvent {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    eventId: randomUUID(),
    executionId: request.executionId,
    correlationId: request.correlationId,
    type: request.type,
    name,
    occurredAt: new Date().toISOString(),
    sequence,
    payload,
  };
}
