import {
  AI_CONTRACT_VERSION,
  parseAiExecutionRequest,
  type AiExecutionRequest,
  type AiExecutionResult,
} from '@influence-maven/ai-contracts';
import type { Agent } from '@mastra/core/agent';
import type { Queue } from 'bullmq';

import type { InfluencerAiEnv } from '../config/env';
import { runIbpGeneration } from '../ibp/run-ibp';
import { resolveProviderMeta } from '../llm/resolve-model';
import { buildEvent, publishEvent, publishResult } from './publish';

export async function handleAiExecutionRequest(params: {
  raw: unknown;
  ibpAgent: Agent;
  env: InfluencerAiEnv;
  resultsQueue: Queue;
  eventsQueue: Queue;
}): Promise<AiExecutionResult> {
  const { raw, ibpAgent, env, resultsQueue, eventsQueue } = params;
  const startedAt = new Date();
  const providerMeta = resolveProviderMeta(env);

  let request: AiExecutionRequest;
  try {
    request = parseAiExecutionRequest(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId:
        typeof (raw as { executionId?: string })?.executionId === 'string'
          ? (raw as { executionId: string }).executionId
          : '00000000-0000-4000-8000-000000000000',
      correlationId:
        typeof (raw as { correlationId?: string })?.correlationId === 'string'
          ? (raw as { correlationId: string }).correlationId
          : '00000000-0000-4000-8000-000000000001',
      type: 'IBP_GENERATION' as const,
      status: 'FAILED' as const,
      metadata: { provider: providerMeta.provider, model: providerMeta.model },
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      error: {
        code: 'AI_CONTEXT_INVALID' as const,
        message: message.slice(0, 2000),
        retryable: false,
        occurredAt: new Date().toISOString(),
      },
    };
    await publishResult(resultsQueue, failed);
    return failed;
  }

  let sequence = 0;
  await publishEvent(
    eventsQueue,
    buildEvent(request, sequence++, 'ai.execution.accepted', {
      kind: 'empty',
    }),
  );
  await publishEvent(
    eventsQueue,
    buildEvent(request, sequence++, 'ai.execution.started', { kind: 'empty' }),
  );

  if (request.type !== 'IBP_GENERATION') {
    const finishedAt = new Date();
    const result: AiExecutionResult = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId: request.executionId,
      correlationId: request.correlationId,
      type: request.type,
      status: 'FAILED',
      metadata: {
        provider: providerMeta.provider,
        model: providerMeta.model,
        llmCallCount: 0,
        warnings: [`Capability ${request.type} not enabled in AI-003.2`],
      },
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: {
        code: 'AI_INTERNAL_ERROR',
        message: `Capability ${request.type} is not migrated yet (AI-003.2 = IBP only)`,
        retryable: false,
        occurredAt: finishedAt.toISOString(),
      },
    };
    await publishResult(resultsQueue, result);
    await publishEvent(
      eventsQueue,
      buildEvent(request, sequence++, 'ai.execution.failed', {
        kind: 'terminal',
        status: 'FAILED',
        errorCode: 'AI_INTERNAL_ERROR',
      }),
    );
    return result;
  }

  const run = await runIbpGeneration(ibpAgent, request);
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const promptBusinessHash = request.instructions.businessHash;

  if (run.ok) {
    const result: AiExecutionResult = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId: request.executionId,
      correlationId: request.correlationId,
      type: 'IBP_GENERATION',
      status: 'COMPLETED',
      output: run.output,
      metadata: {
        provider: providerMeta.provider,
        model: providerMeta.model,
        llmCallCount: run.llmCallCount,
        promptBusinessHash,
      },
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
    };
    await publishResult(resultsQueue, result);
    await publishEvent(
      eventsQueue,
      buildEvent(request, sequence++, 'ai.execution.completed', {
        kind: 'terminal',
        status: 'COMPLETED',
      }),
    );
    return result;
  }

  const result: AiExecutionResult = {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: request.executionId,
    correlationId: request.correlationId,
    type: 'IBP_GENERATION',
    status: 'FAILED',
    metadata: {
      provider: providerMeta.provider,
      model: providerMeta.model,
      llmCallCount: run.llmCallCount,
      promptBusinessHash,
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    error: {
      code: run.code,
      message: run.message,
      retryable: run.retryable,
      occurredAt: finishedAt.toISOString(),
    },
  };
  await publishResult(resultsQueue, result);
  await publishEvent(
    eventsQueue,
    buildEvent(request, sequence++, 'ai.execution.failed', {
      kind: 'terminal',
      status: 'FAILED',
      errorCode: run.code,
    }),
  );
  return result;
}
