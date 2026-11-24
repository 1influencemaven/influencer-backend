import {
  brandDiscoveryOutputSchema,
  type AiExecutionRequest,
  type BrandDiscoveryOutput,
} from '@influence-maven/ai-contracts';
import type { Agent } from '@mastra/core/agent';
import { MastraError } from '@mastra/core/error';
import { z } from 'zod';

import { executionDeadlineSignal } from './execution-deadline';
import {
  buildBrandDiscoveryPlanCorrectionPrompt,
  buildBrandDiscoveryPlanUserPrompt,
} from '../prompts/brand-discovery-plan.prompt';

export type RunBrandDiscoveryPlanSuccess = {
  ok: true;
  output: Extract<BrandDiscoveryOutput, { operation: 'PLAN_SEARCH' }>;
  llmCallCount: number;
};

export type RunBrandDiscoveryPlanFailure = {
  ok: false;
  code: 'AI_INVALID_OUTPUT' | 'AI_PROVIDER_ERROR' | 'AI_INTERNAL_ERROR';
  message: string;
  retryable: boolean;
  llmCallCount: number;
};

export type RunBrandDiscoveryPlanResult =
  | RunBrandDiscoveryPlanSuccess
  | RunBrandDiscoveryPlanFailure;

type BrandDiscoveryRequest = Extract<
  AiExecutionRequest,
  { type: 'BRAND_DISCOVERY' }
>;

type PlanOutput = Extract<BrandDiscoveryOutput, { operation: 'PLAN_SEARCH' }>;

type AttemptResult =
  | { kind: 'ok'; output: PlanOutput }
  | { kind: 'invalid_structured'; message: string; previousRaw: string }
  | { kind: 'provider'; message: string }
  | { kind: 'internal'; message: string };

/** Mastra structured-output failure ids (see @mastra/core isStructuredOutputFormatError). */
const RECOVERABLE_STRUCTURED_OUTPUT_IDS = new Set([
  'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED',
  'STRUCTURED_OUTPUT_OBJECT_UNDEFINED',
  'STRUCTURED_OUTPUT_TRUNCATED',
]);

function buildPlanLlmSchema(maxQueries: number) {
  return z.object({
    queries: z.array(z.string().min(1)).min(1).max(maxQueries),
  });
}

function assemblePlanOutput(
  object: unknown,
  maxQueries: number,
):
  | { ok: true; output: PlanOutput }
  | { ok: false; message: string; previousRaw: string } {
  const local = buildPlanLlmSchema(maxQueries).safeParse(object);
  if (!local.success) {
    return {
      ok: false,
      message: local.error.message,
      previousRaw: safeRaw(object),
    };
  }

  const candidate = {
    operation: 'PLAN_SEARCH' as const,
    queries: local.data.queries,
  };
  const contract = brandDiscoveryOutputSchema.safeParse(candidate);
  if (!contract.success) {
    return {
      ok: false,
      message: contract.error.message,
      previousRaw: safeRaw(object),
    };
  }
  if (contract.data.operation !== 'PLAN_SEARCH') {
    return {
      ok: false,
      message: 'Unexpected Brand Discovery operation in assembled output',
      previousRaw: safeRaw(object),
    };
  }

  return { ok: true, output: contract.data };
}

function safeRaw(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function isRecoverableStructuredOutputError(error: unknown): boolean {
  return (
    error instanceof MastraError &&
    RECOVERABLE_STRUCTURED_OUTPUT_IDS.has(error.id)
  );
}

function isProviderLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNREFUSED|timeout|429|5\d\d|API key|Ollama/i.test(
    message,
  );
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function structuredOutputPreviousRaw(error: unknown): string {
  if (!(error instanceof MastraError)) {
    return '';
  }
  const value = error.details?.value;
  return typeof value === 'string' ? value : '';
}

/**
 * Execute Brand Discovery PLAN_SEARCH via Mastra Agent + structuredOutput.
 * Retries once on missing/invalid structured output, including Mastra
 * STRUCTURED_OUTPUT_* validation throws.
 */
export async function runBrandDiscoveryPlanSearch(
  agent: Agent,
  request: BrandDiscoveryRequest,
): Promise<RunBrandDiscoveryPlanResult> {
  if (request.input.operation !== 'PLAN_SEARCH') {
    return {
      ok: false,
      code: 'AI_INTERNAL_ERROR',
      message: `runBrandDiscoveryPlanSearch supports PLAN_SEARCH only (got ${request.input.operation})`,
      retryable: false,
      llmCallCount: 0,
    };
  }

  const { maxQueries } = request.input;
  const llmSchema = buildPlanLlmSchema(maxQueries);
  const userPrompt = buildBrandDiscoveryPlanUserPrompt({
    influencerName: request.input.influencerName,
    niche: request.input.niche,
    subNiche: request.input.subNiche,
    niches: request.input.niches,
    country: request.input.country,
    language: request.input.language,
    followers: request.input.followers,
    engagement: request.input.engagement,
    ibp: request.input.ibp,
    maxQueries,
    businessInstructions: request.instructions.business,
  });

  let llmCallCount = 0;
  const abortSignal = executionDeadlineSignal(request);

  const attempt = async (prompt: string): Promise<AttemptResult> => {
    llmCallCount += 1;
    try {
      const generated = await agent.generate(prompt, {
        abortSignal,
        structuredOutput: {
          schema: llmSchema,
          jsonPromptInjection: 'auto',
        },
      });

      if (generated.object) {
        const assembled = assemblePlanOutput(generated.object, maxQueries);
        if (assembled.ok) {
          return { kind: 'ok', output: assembled.output };
        }
        return {
          kind: 'invalid_structured',
          message: assembled.message,
          previousRaw: assembled.previousRaw || (generated.text ?? ''),
        };
      }

      return {
        kind: 'invalid_structured',
        message: 'PLAN_SEARCH structured output missing',
        previousRaw: generated.text ?? '',
      };
    } catch (error) {
      if (isRecoverableStructuredOutputError(error)) {
        return {
          kind: 'invalid_structured',
          message: errorMessage(error),
          previousRaw: structuredOutputPreviousRaw(error),
        };
      }
      if (isProviderLikeError(error)) {
        return { kind: 'provider', message: errorMessage(error) };
      }
      return { kind: 'internal', message: errorMessage(error) };
    }
  };

  const first = await attempt(userPrompt);
  if (first.kind === 'ok') {
    return { ok: true, output: first.output, llmCallCount };
  }
  if (first.kind === 'provider') {
    return {
      ok: false,
      code: 'AI_PROVIDER_ERROR',
      message: first.message,
      retryable: true,
      llmCallCount,
    };
  }
  if (first.kind === 'internal') {
    return {
      ok: false,
      code: 'AI_INTERNAL_ERROR',
      message: first.message,
      retryable: false,
      llmCallCount,
    };
  }

  const correction = buildBrandDiscoveryPlanCorrectionPrompt({
    previousRaw: first.previousRaw,
    errorMessage: first.message,
    maxQueries,
  });
  const second = await attempt(correction);

  if (second.kind === 'ok') {
    return { ok: true, output: second.output, llmCallCount };
  }
  if (second.kind === 'provider') {
    return {
      ok: false,
      code: 'AI_PROVIDER_ERROR',
      message: second.message,
      retryable: true,
      llmCallCount,
    };
  }
  if (second.kind === 'internal') {
    return {
      ok: false,
      code: 'AI_INTERNAL_ERROR',
      message: second.message,
      retryable: false,
      llmCallCount,
    };
  }

  return {
    ok: false,
    code: 'AI_INVALID_OUTPUT',
    message: (
      second.message.endsWith('structured output missing')
        ? `${second.message} after retry`
        : second.message
    ).slice(0, 2000),
    retryable: true,
    llmCallCount,
  };
}
