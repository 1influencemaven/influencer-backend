import {
  brandDiscoveryOutputSchema,
  scoredBrandSchema,
  type AiExecutionRequest,
  type BrandDiscoveryOutput,
} from '@influence-maven/ai-contracts';
import type { Agent } from '@mastra/core/agent';
import { MastraError } from '@mastra/core/error';
import { z } from 'zod';

import {
  buildBrandDiscoveryScoreCorrectionPrompt,
  buildBrandDiscoveryScoreUserPrompt,
} from '../prompts/brand-discovery-score.prompt';

export type RunBrandDiscoveryScoreSuccess = {
  ok: true;
  output: Extract<BrandDiscoveryOutput, { operation: 'SCORE_CANDIDATES' }>;
  llmCallCount: number;
};

export type RunBrandDiscoveryScoreFailure = {
  ok: false;
  code: 'AI_INVALID_OUTPUT' | 'AI_PROVIDER_ERROR' | 'AI_INTERNAL_ERROR';
  message: string;
  retryable: boolean;
  llmCallCount: number;
};

export type RunBrandDiscoveryScoreResult =
  | RunBrandDiscoveryScoreSuccess
  | RunBrandDiscoveryScoreFailure;

type BrandDiscoveryRequest = Extract<
  AiExecutionRequest,
  { type: 'BRAND_DISCOVERY' }
>;

type ScoreOutput = Extract<
  BrandDiscoveryOutput,
  { operation: 'SCORE_CANDIDATES' }
>;

type AttemptResult =
  | { kind: 'ok'; output: ScoreOutput }
  | { kind: 'invalid_structured'; message: string; previousRaw: string }
  | { kind: 'provider'; message: string }
  | { kind: 'internal'; message: string };

/** Mastra structured-output failure ids (see @mastra/core isStructuredOutputFormatError). */
const RECOVERABLE_STRUCTURED_OUTPUT_IDS = new Set([
  'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED',
  'STRUCTURED_OUTPUT_OBJECT_UNDEFINED',
  'STRUCTURED_OUTPUT_TRUNCATED',
]);

/**
 * Local LLM schema: { brands } only. Enforces score as int 0-100 and brands.length <= limit.
 * operation is assembled by the runner.
 */
function buildScoreLlmSchema(limit: number) {
  return z.object({
    brands: z
      .array(
        scoredBrandSchema.extend({
          score: z.number().int().min(0).max(100),
        }),
      )
      .max(limit),
  });
}

function assembleScoreOutput(
  object: unknown,
  limit: number,
):
  | { ok: true; output: ScoreOutput }
  | { ok: false; message: string; previousRaw: string } {
  const local = buildScoreLlmSchema(limit).safeParse(object);
  if (!local.success) {
    return {
      ok: false,
      message: local.error.message,
      previousRaw: safeRaw(object),
    };
  }

  const candidate = {
    operation: 'SCORE_CANDIDATES' as const,
    brands: local.data.brands,
  };
  const contract = brandDiscoveryOutputSchema.safeParse(candidate);
  if (!contract.success) {
    return {
      ok: false,
      message: contract.error.message,
      previousRaw: safeRaw(object),
    };
  }
  if (contract.data.operation !== 'SCORE_CANDIDATES') {
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
 * Execute Brand Discovery SCORE_CANDIDATES via Mastra Agent + structuredOutput.
 * Retries once on missing/invalid structured output, including Mastra
 * STRUCTURED_OUTPUT_* validation throws.
 */
export async function runBrandDiscoveryScoreCandidates(
  agent: Agent,
  request: BrandDiscoveryRequest,
): Promise<RunBrandDiscoveryScoreResult> {
  if (request.input.operation !== 'SCORE_CANDIDATES') {
    return {
      ok: false,
      code: 'AI_INTERNAL_ERROR',
      message: `runBrandDiscoveryScoreCandidates supports SCORE_CANDIDATES only (got ${request.input.operation})`,
      retryable: false,
      llmCallCount: 0,
    };
  }

  const { limit } = request.input;
  const llmSchema = buildScoreLlmSchema(limit);
  const userPrompt = buildBrandDiscoveryScoreUserPrompt({
    influencerName: request.input.influencerName,
    niche: request.input.niche,
    ibp: request.input.ibp,
    limit,
    searchHits: request.input.searchHits,
    seedBrands: request.input.seedBrands,
    businessInstructions: request.instructions.business,
  });

  let llmCallCount = 0;

  const attempt = async (prompt: string): Promise<AttemptResult> => {
    llmCallCount += 1;
    try {
      const generated = await agent.generate(prompt, {
        structuredOutput: {
          schema: llmSchema,
          jsonPromptInjection: 'auto',
        },
      });

      if (generated.object) {
        const assembled = assembleScoreOutput(generated.object, limit);
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
        message: 'SCORE_CANDIDATES structured output missing',
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

  const correction = buildBrandDiscoveryScoreCorrectionPrompt({
    previousRaw: first.previousRaw,
    errorMessage: first.message,
    limit,
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
