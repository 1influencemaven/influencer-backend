import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AiService } from './ai.service';
import { LLM_PROVIDER_TOKEN } from './interfaces/llm-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';
import { CursorProvider } from './providers/cursor.provider';
import { MockLlmProvider } from './providers/mock-llm.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    AiService,
    AnthropicProvider,
    CursorProvider,
    MockLlmProvider,
    {
      provide: LLM_PROVIDER_TOKEN,
      inject: [
        ConfigService,
        AnthropicProvider,
        CursorProvider,
        MockLlmProvider,
      ],
      useFactory: (
        configService: ConfigService,
        anthropicProvider: AnthropicProvider,
        cursorProvider: CursorProvider,
        mockProvider: MockLlmProvider,
      ) => {
        if (configService.get<string>('NODE_ENV') === 'test') {
          return mockProvider;
        }

        const provider =
          configService.get<string>('AI_PROVIDER') ??
          (configService.get<string>('NODE_ENV') === 'production'
            ? 'anthropic'
            : 'cursor');

        if (provider === 'anthropic') {
          return anthropicProvider;
        }

        return cursorProvider;
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
