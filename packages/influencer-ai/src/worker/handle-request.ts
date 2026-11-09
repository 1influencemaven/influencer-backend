import {
  AI_CONTRACT_VERSION,
  parseAiExecutionRequest,
  parseAiExecutionResult,
  type AiExecutionRequest,
  type AiExecutionResult,
} from '@influence-maven/ai-contracts';
import type { Agent } from '@mastra/core/agent';
import type { Queue } from 'bullmq';

import { runBrandDiscoveryPlanSearch } from '../brand-discovery/run-plan-search';
import { runBrandDiscoveryScoreCandidates } from '../brand-discovery/run-score-candidates';
import type { InfluencerAiEnv } from '../config/env';
import { runContactResearchFindBrandEmails } from '../contact-research/run-find-brand-emails';
import { runContactResearchFindBrandPeople } from '../contact-research/run-find-brand-people';
import { runIbpGeneration } from '../ibp/run-ibp';
import { resolveProviderMeta } from '../llm/resolve-model';
import { buildEvent, publishEvent, publishResult } from './publish';

export async function handleAiExecutionRequest(params: {
  raw: unknown;
  ibpAgent: Agent;
  brandDiscoveryAgent: Agent;
  env: InfluencerAiEnv;
  resultsQueue: Queue;
  eventsQueue: Queue;
}): Promise<AiExecutionResult> {
  const { raw, ibpAgent, brandDiscoveryAgent, env, resultsQueue, eventsQueue } =
    params;
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

  if (request.type === 'IBP_GENERATION') {
    return finalizeIbp({
      request,
      ibpAgent,
      providerMeta,
      startedAt,
      sequence,
      resultsQueue,
      eventsQueue,
    });
  }

  if (request.type === 'BRAND_DISCOVERY') {
    return finalizeBrandDiscovery({
      request,
      brandDiscoveryAgent,
      providerMeta,
      startedAt,
      sequence,
      resultsQueue,
      eventsQueue,
    });
  }

  if (request.type === 'CONTACT_RESEARCH') {
    return finalizeContactResearch({
      request,
      env,
      providerMeta,
      startedAt,
      sequence,
      resultsQueue,
      eventsQueue,
    });
  }

  const finishedAt = new Date();
  const result = parseAiExecutionResult({
    contractVersion: AI_CONTRACT_VERSION,
    executionId: request.executionId,
    correlationId: request.correlationId,
    type: request.type,
    status: 'FAILED',
    metadata: {
      provider: providerMeta.provider,
      model: providerMeta.model,
      llmCallCount: 0,
      warnings: [`Capability ${request.type} not enabled in influencer-ai`],
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    error: {
      code: 'AI_INTERNAL_ERROR',
      message: `Capability ${request.type} is not migrated yet (influencer-ai supports IBP_GENERATION, BRAND_DISCOVERY, CONTACT_RESEARCH/FIND_BRAND_EMAILS|FIND_BRAND_PEOPLE)`,
      retryable: false,
      occurredAt: finishedAt.toISOString(),
    },
  });
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

async function finalizeIbp(params: {
  request: Extract<AiExecutionRequest, { type: 'IBP_GENERATION' }>;
  ibpAgent: Agent;
  providerMeta: { provider: string; model: string };
  startedAt: Date;
  sequence: number;
  resultsQueue: Queue;
  eventsQueue: Queue;
}): Promise<AiExecutionResult> {
  const {
    request,
    ibpAgent,
    providerMeta,
    startedAt,
    resultsQueue,
    eventsQueue,
  } = params;
  let sequence = params.sequence;

  const run = await runIbpGeneration(ibpAgent, request);
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const promptBusinessHash = request.instructions.businessHash;

  if (run.ok) {
    const result = parseAiExecutionResult({
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
    });
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

  const result = parseAiExecutionResult({
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
  });
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

async function finalizeBrandDiscovery(params: {
  request: Extract<AiExecutionRequest, { type: 'BRAND_DISCOVERY' }>;
  brandDiscoveryAgent: Agent;
  providerMeta: { provider: string; model: string };
  startedAt: Date;
  sequence: number;
  resultsQueue: Queue;
  eventsQueue: Queue;
}): Promise<AiExecutionResult> {
  const {
    request,
    brandDiscoveryAgent,
    providerMeta,
    startedAt,
    resultsQueue,
    eventsQueue,
  } = params;
  let sequence = params.sequence;
  const promptBusinessHash = request.instructions.businessHash;

  const run =
    request.input.operation === 'PLAN_SEARCH'
      ? await runBrandDiscoveryPlanSearch(brandDiscoveryAgent, request)
      : request.input.operation === 'SCORE_CANDIDATES'
        ? await runBrandDiscoveryScoreCandidates(brandDiscoveryAgent, request)
        : {
            ok: false as const,
            code: 'AI_INTERNAL_ERROR' as const,
            message: `Unsupported Brand Discovery operation`,
            retryable: false,
            llmCallCount: 0,
          };

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  if (run.ok) {
    const result = parseAiExecutionResult({
      contractVersion: AI_CONTRACT_VERSION,
      executionId: request.executionId,
      correlationId: request.correlationId,
      type: 'BRAND_DISCOVERY',
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
    });
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

  const result = parseAiExecutionResult({
    contractVersion: AI_CONTRACT_VERSION,
    executionId: request.executionId,
    correlationId: request.correlationId,
    type: 'BRAND_DISCOVERY',
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
  });
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

async function finalizeContactResearch(params: {
  request: Extract<AiExecutionRequest, { type: 'CONTACT_RESEARCH' }>;
  env: InfluencerAiEnv;
  providerMeta: { provider: string; model: string };
  startedAt: Date;
  sequence: number;
  resultsQueue: Queue;
  eventsQueue: Queue;
}): Promise<AiExecutionResult> {
  const { request, env, providerMeta, startedAt, resultsQueue, eventsQueue } =
    params;
  let sequence = params.sequence;
  const promptBusinessHash = request.instructions.businessHash;

  const run =
    request.input.operation === 'FIND_BRAND_EMAILS'
      ? await runContactResearchFindBrandEmails(env, request)
      : request.input.operation === 'FIND_BRAND_PEOPLE'
        ? await runContactResearchFindBrandPeople(env, request)
        : {
            ok: false as const,
            code: 'AI_INTERNAL_ERROR' as const,
            message:
              'CONTACT_RESEARCH DECIDE_STEP stays on Nest; influencer-ai supports FIND_BRAND_EMAILS and FIND_BRAND_PEOPLE',
            retryable: false,
            llmCallCount: 0,
          };

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  if (run.ok) {
    const result = parseAiExecutionResult({
      contractVersion: AI_CONTRACT_VERSION,
      executionId: request.executionId,
      correlationId: request.correlationId,
      type: 'CONTACT_RESEARCH',
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
    });
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

  const result = parseAiExecutionResult({
    contractVersion: AI_CONTRACT_VERSION,
    executionId: request.executionId,
    correlationId: request.correlationId,
    type: 'CONTACT_RESEARCH',
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
  });
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

