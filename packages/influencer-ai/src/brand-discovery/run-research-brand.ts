import {
  brandDeepResearchOutputBodyLlmCaptureSchema,
  brandDeepResearchOutputBodySchema,
  brandDiscoveryOutputSchema,
  type AiExecutionRequest,
  type BrandDiscoveryOutput,
} from '@influence-maven/ai-contracts';
import type { Agent } from '@mastra/core/agent';
import { MastraError } from '@mastra/core/error';
import { z } from 'zod';

import {
  buildBrandDiscoveryResearchCorrectionPrompt,
  buildBrandDiscoveryResearchUserPrompt,
} from '../prompts/brand-discovery-research.prompt';
import { normalizeResearchLlmObject } from './normalize-research-llm-object';
import { executionDeadlineSignal } from './execution-deadline';

export type RunBrandDiscoveryResearchSuccess = {
  ok: true;
  output: Extract<BrandDiscoveryOutput, { operation: 'RESEARCH_BRAND' }>;
  llmCallCount: number;
};

export type RunBrandDiscoveryResearchFailure = {
  ok: false;
  code: 'AI_INVALID_OUTPUT' | 'AI_PROVIDER_ERROR' | 'AI_INTERNAL_ERROR';
  message: string;
  retryable: boolean;
  llmCallCount: number;
};

export type RunBrandDiscoveryResearchResult =
  | RunBrandDiscoveryResearchSuccess
  | RunBrandDiscoveryResearchFailure;

type BrandDiscoveryRequest = Extract<
  AiExecutionRequest,
  { type: 'BRAND_DISCOVERY' }
>;

type ResearchOutput = Extract<
  BrandDiscoveryOutput,
  { operation: 'RESEARCH_BRAND' }
>;

type AttemptResult =
  | { kind: 'ok'; output: ResearchOutput }
  | { kind: 'invalid_structured'; message: string; previousRaw: string }
  | { kind: 'provider'; message: string }
  | { kind: 'internal'; message: string };

const RECOVERABLE_STRUCTURED_OUTPUT_IDS = new Set([
  'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED',
  'STRUCTURED_OUTPUT_OBJECT_UNDEFINED',
  'STRUCTURED_OUTPUT_TRUNCATED',
]);

/** Lenient Mastra capture; strict body after normalize. */
const researchLlmCaptureSchema = brandDeepResearchOutputBodyLlmCaptureSchema;
const researchLlmStrictSchema = brandDeepResearchOutputBodySchema;

function assembleResearchOutput(
  object: unknown,
):
  | { ok: true; output: ResearchOutput }
  | { ok: false; message: string; previousRaw: string } {
  const normalized = normalizeResearchLlmObject(object);
  const local = researchLlmStrictSchema.safeParse(normalized);
  if (!local.success) {
    return {
      ok: false,
      message: local.error.message,
      previousRaw: safeRaw(object),
    };
  }

  const candidate = {
    operation: 'RESEARCH_BRAND' as const,
    ...local.data,
  };
  const contract = brandDiscoveryOutputSchema.safeParse(candidate);
  if (!contract.success) {
    return {
      ok: false,
      message: contract.error.message,
      previousRaw: safeRaw(object),
    };
  }
  if (contract.data.operation !== 'RESEARCH_BRAND') {
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
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('fetch failed') ||
    msg.includes('429') ||
    msg.includes('rate limit')
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
 * Execute Brand Discovery RESEARCH_BRAND via Mastra Agent + structuredOutput.
 */
export async function runBrandDiscoveryResearchBrand(
  agent: Agent,
  request: BrandDiscoveryRequest,
): Promise<RunBrandDiscoveryResearchResult> {
  if (request.input.operation !== 'RESEARCH_BRAND') {
    return {
      ok: false,
      code: 'AI_INTERNAL_ERROR',
      message: `runBrandDiscoveryResearchBrand supports RESEARCH_BRAND only (got ${request.input.operation})`,
      retryable: false,
      llmCallCount: 0,
    };
  }

  const input = request.input;
  const userPrompt = buildBrandDiscoveryResearchUserPrompt({
    influencerName: input.influencerName,
    niche: input.niche,
    subNiche: input.subNiche,
    country: input.country,
    language: input.language,
    followers: input.followers,
    engagement: input.engagement,
    ibp: input.ibp,
    brand: input.brand,
    pageSnapshots: input.pageSnapshots,
    maxPages: input.maxPages,
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
          // Lenient capture — strict Zod after normalizeResearchLlmObject.
          schema: researchLlmCaptureSchema as z.ZodType,
          jsonPromptInjection: 'auto',
        },
      });

      if (generated.object) {
        const assembled = assembleResearchOutput(generated.object);
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
        message: 'RESEARCH_BRAND structured output missing',
        previousRaw: generated.text ?? '',
      };
    } catch (error) {
      if (isRecoverableStructuredOutputError(error)) {
        const previousRaw = structuredOutputPreviousRaw(error);
        let parsed: unknown = previousRaw;
        try {
          parsed = JSON.parse(previousRaw);
        } catch {
          // keep string — assemble will fail and surface for correction retry
        }
        if (parsed && typeof parsed === 'object') {
          const recovered = assembleResearchOutput(parsed);
          if (recovered.ok) {
            return { kind: 'ok', output: recovered.output };
          }
          return {
            kind: 'invalid_structured',
            message: recovered.message,
            previousRaw: previousRaw || errorMessage(error),
          };
        }
        return {
          kind: 'invalid_structured',
          message: errorMessage(error),
          previousRaw,
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

  const correction = buildBrandDiscoveryResearchCorrectionPrompt({
    previousRaw: first.previousRaw,
    errorMessage: first.message,
  });
  const second = await attempt(`${userPrompt}\n\n${correction}`);
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
  return {
    ok: false,
    code: 'AI_INVALID_OUTPUT',
    message:
      second.kind === 'invalid_structured' || second.kind === 'internal'
        ? second.message
        : first.message,
    retryable: false,
    llmCallCount,
  };
}
