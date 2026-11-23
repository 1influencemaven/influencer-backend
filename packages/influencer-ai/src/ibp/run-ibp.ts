import {
  ibpGenerationOutputLlmCaptureSchema,
  ibpGenerationOutputSchema,
  type AiExecutionRequest,
  type IbpGenerationOutput,
} from '@influence-maven/ai-contracts';
import type { Agent } from '@mastra/core/agent';

import { buildIbpUserPrompt } from '../prompts/ibp.prompt';
import {
  isIbpStructuredValidationError,
  normalizeIbpLlmObject,
} from './normalize-ibp-llm-object';

export type RunIbpSuccess = {
  ok: true;
  output: IbpGenerationOutput;
  llmCallCount: number;
};

export type RunIbpFailure = {
  ok: false;
  code: 'AI_INVALID_OUTPUT' | 'AI_PROVIDER_ERROR' | 'AI_INTERNAL_ERROR';
  message: string;
  retryable: boolean;
  llmCallCount: number;
};

export type RunIbpResult = RunIbpSuccess | RunIbpFailure;

function parseIbpOutput(raw: unknown): IbpGenerationOutput {
  return ibpGenerationOutputSchema.parse(normalizeIbpLlmObject(raw));
}

function isProviderError(message: string): boolean {
  return /fetch failed|ECONNREFUSED|timeout|429|5\d\d|API key|Ollama/i.test(
    message,
  );
}

/**
 * Execute IBP + talent interpretation via Mastra Agent + structuredOutput (Zod).
 * Soft-repairs missing brand_reference disclaimer; retries once on invalid output.
 */
export async function runIbpGeneration(
  agent: Agent,
  request: Extract<AiExecutionRequest, { type: 'IBP_GENERATION' }>,
): Promise<RunIbpResult> {
  const userPrompt = buildIbpUserPrompt(
    request.input,
    request.instructions.business,
  );

  let llmCallCount = 0;

  const generateOnce = async (prompt: string) => {
    llmCallCount += 1;
    return agent.generate(prompt, {
      structuredOutput: {
        // Lenient capture — disclaimer/superRefine applied after normalize.
        schema: ibpGenerationOutputLlmCaptureSchema,
        jsonPromptInjection: 'auto',
      },
    });
  };

  const correctionFor = (detail: string) =>
    `Your previous response was invalid JSON or did not match the required schema.

Validation detail:
${detail.slice(0, 1500)}

Return ONLY a corrected JSON object with ALL required fields:
targetSectors, excludedSectors, brandSize, markets, collaborationTypes, summary, alertSignals, desirableCriteria,
AND talentInterpretation { outputVersion:"1.0", insufficientEvidence, summary, niches, contentCategories, commercialSignals, limitations }.
CRITICAL: every commercialSignals item with type "brand_reference" MUST include a non-empty "disclaimer" stating the mention is not a sponsorship.
Do not invent metrics. Cite only fieldPaths present in the provided Instagram evidence.`;

  // The agent keeps no conversation history: a retry must carry the original
  // prompt (influencer payload + evidence), not just the correction text.
  const retryPrompt = (detail: string) =>
    `${userPrompt}\n\n---\n${correctionFor(detail)}`;

  try {
    const first = await generateOnce(userPrompt);
    if (first.object) {
      const output = parseIbpOutput(first.object);
      return { ok: true, output, llmCallCount };
    }

    const second = await generateOnce(
      retryPrompt(first.text ?? 'structured object missing'),
    );
    if (!second.object) {
      return {
        ok: false,
        code: 'AI_INVALID_OUTPUT',
        message: 'IBP structured output missing after retry',
        retryable: true,
        llmCallCount,
      };
    }

    const output = parseIbpOutput(second.object);
    return { ok: true, output, llmCallCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isProviderError(message)) {
      return {
        ok: false,
        code: 'AI_PROVIDER_ERROR',
        message: message.slice(0, 2000),
        retryable: true,
        llmCallCount,
      };
    }

    // Mastra may throw on Zod structuredOutput before returning object — retry once.
    if (isIbpStructuredValidationError(error) && llmCallCount < 2) {
      try {
        const retry = await generateOnce(retryPrompt(message));
        if (retry.object) {
          const output = parseIbpOutput(retry.object);
          return { ok: true, output, llmCallCount };
        }
        return {
          ok: false,
          code: 'AI_INVALID_OUTPUT',
          message: 'IBP structured output missing after validation retry',
          retryable: true,
          llmCallCount,
        };
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : String(retryError);
        if (isProviderError(retryMessage)) {
          return {
            ok: false,
            code: 'AI_PROVIDER_ERROR',
            message: retryMessage.slice(0, 2000),
            retryable: true,
            llmCallCount,
          };
        }
        return {
          ok: false,
          code: 'AI_INVALID_OUTPUT',
          message: retryMessage.slice(0, 2000),
          retryable: true,
          llmCallCount,
        };
      }
    }

    if (isIbpStructuredValidationError(error)) {
      return {
        ok: false,
        code: 'AI_INVALID_OUTPUT',
        message: message.slice(0, 2000),
        retryable: true,
        llmCallCount,
      };
    }

    return {
      ok: false,
      code: 'AI_INTERNAL_ERROR',
      message: message.slice(0, 2000),
      retryable: false,
      llmCallCount,
    };
  }
}
