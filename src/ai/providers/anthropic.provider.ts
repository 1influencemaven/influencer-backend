import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

import type { LlmProvider } from '../interfaces/llm-provider.interface';

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly logger = new Logger(AnthropicProvider.name);

  constructor(private readonly configService: ConfigService) {
    this.model =
      this.configService.get<string>('ANTHROPIC_MODEL') ??
      'claude-sonnet-4-20250514';

    this.client = new Anthropic({
      apiKey: this.configService.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  async complete(prompt: string): Promise<string> {
    this.logger.debug(`Calling Anthropic model ${this.model}`);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');

    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Anthropic response did not contain text content');
    }

    return textBlock.text;
  }
}
