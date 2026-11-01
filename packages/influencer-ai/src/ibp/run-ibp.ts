import {
  ibpGenerationOutputSchema,
  type AiExecutionRequest,
  type IbpGenerationOutput,
} from '@influence-maven/ai-contracts';
import type { Agent } from '@mastra/core/agent';

import { buildIbpUserPrompt } from '../prompts/ibp.prompt';

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

/**
 * Execute IBP generation via Mastra Agent + structuredOutput (Zod).
 * Retries once on invalid output (parity with Nest AiService).
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
        schema: ibpGenerationOutputSchema,
        jsonPromptInjection: 'auto',
      },
    });
  };

  try {
    const first = await generateOnce(userPrompt);
    if (first.object) {
      const output = ibpGenerationOutputSchema.parse(first.object);
      return { ok: true, output, llmCallCount };
    }

    const text = first.text ?? '';
    const correction = `Your previous response was invalid JSON or did not match the required schema.

Previous response:
${text}

Return ONLY a corrected JSON object with the required fields:
targetSectors, excludedSectors, brandSize, markets, collaborationTypes, summary, alertSignals, desirableCriteria`;

    const second = await generateOnce(correction);
    if (!second.object) {
      return {
        ok: false,
        code: 'AI_INVALID_OUTPUT',
        message: 'IBP structured output missing after retry',
        retryable: true,
        llmCallCount,
      };
    }

    const output = ibpGenerationOutputSchema.parse(second.object);
    return { ok: true, output, llmCallCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const providerLike =
      /fetch failed|ECONNREFUSED|timeout|429|5\d\d|API key|Ollama/i.test(
        message,
      );

    return {
      ok: false,
      code: providerLike ? 'AI_PROVIDER_ERROR' : 'AI_INTERNAL_ERROR',
      message: message.slice(0, 2000),
      retryable: providerLike,
      llmCallCount,
    };
  }
}
