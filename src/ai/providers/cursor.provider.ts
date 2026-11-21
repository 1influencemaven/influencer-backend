import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from '@cursor/sdk';

import type { LlmProvider } from '../interfaces/llm-provider.interface';

@Injectable()
export class CursorProvider implements LlmProvider {
  readonly name = 'cursor' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly logger = new Logger(CursorProvider.name);

  constructor(private readonly configService: ConfigService) {
    this.model =
      this.configService.get<string>('CURSOR_MODEL') ?? 'composer-2.5';
    this.apiKey = this.configService.getOrThrow<string>('CURSOR_API_KEY');
  }

  async complete(prompt: string): Promise<string> {
    this.logger.debug(`Calling Cursor model ${this.model}`);

    const result = await Agent.prompt(prompt, {
      apiKey: this.apiKey,
      model: { id: this.model },
      cloud: {},
    });

    if (!result.result) {
      throw new Error('Cursor response did not contain a result');
    }

    return result.result;
  }
}
