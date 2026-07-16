import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import type { Influencer } from '../generated/prisma/client';
import {
  buildGenerateIbpPrompt,
  buildIbpCorrectionPrompt,
  DEFAULT_IBP_INSTRUCTIONS,
} from './prompts/generate-ibp.prompt';
import {
  LLM_PROVIDER_TOKEN,
  type LlmProvider,
} from './interfaces/llm-provider.interface';
import { parseIbpOutput, type IbpOutput } from './schemas/ibp-output.schema';

export type GenerateIbpResult = IbpOutput & {
  metadata: {
    provider: string;
    model: string;
    lastGeneratedAt: string;
    promptVersion: string;
    promptInstructionsHash: string;
  };
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private static readonly PROMPT_VERSION = '2';

  constructor(
    @Inject(LLM_PROVIDER_TOKEN) private readonly llmProvider: LlmProvider,
  ) {}

  async generateIdealBrandProfile(
    influencer: Influencer,
    instructions: string = DEFAULT_IBP_INSTRUCTIONS,
  ): Promise<GenerateIbpResult> {
    const prompt = buildGenerateIbpPrompt(influencer, instructions);
    let rawResponse = await this.llmProvider.complete(prompt);

    try {
      const output = parseIbpOutput(rawResponse);
      return this.wrapResult(output, instructions);
    } catch (firstError) {
      const errorMessage =
        firstError instanceof Error ? firstError.message : 'Invalid JSON';

      this.logger.warn(
        `IBP parse failed for influencer ${influencer.id}, retrying: ${errorMessage}`,
      );

      const correctionPrompt = buildIbpCorrectionPrompt(
        rawResponse,
        errorMessage,
      );
      rawResponse = await this.llmProvider.complete(correctionPrompt);
      const output = parseIbpOutput(rawResponse);
      return this.wrapResult(output, instructions);
    }
  }

  private wrapResult(
    output: IbpOutput,
    instructions: string,
  ): GenerateIbpResult {
    return {
      ...output,
      metadata: {
        provider: this.llmProvider.name,
        model: this.llmProvider.model,
        lastGeneratedAt: new Date().toISOString(),
        promptVersion: AiService.PROMPT_VERSION,
        promptInstructionsHash: createHash('sha256')
          .update(instructions)
          .digest('hex')
          .slice(0, 16),
      },
    };
  }
}
