import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AiService } from './ai.service';
import { LLM_PROVIDER_TOKEN } from './interfaces/llm-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';
import { CursorProvider } from './providers/cursor.provider';
import { MockLlmProvider } from './providers/mock-llm.provider';
import { OllamaProvider } from './providers/ollama.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    AiService,
    {
      provide: LLM_PROVIDER_TOKEN,
      inject: [ConfigService],
      // Instanciación perezosa: solo se construye el provider seleccionado.
      // Cursor/Anthropic hacen getOrThrow de su API key; Ollama no requiere key.
      useFactory: (configService: ConfigService) => {
        if (configService.get<string>('NODE_ENV') === 'test') {
          return new MockLlmProvider();
        }

        // Local: prefer AI_PROVIDER=ollama (no Cursor dependency).
        // Production: AI_PROVIDER=anthropic (+ ANTHROPIC_API_KEY).
        // Cursor remains an optional dev tool when AI_PROVIDER=cursor.
        const provider =
          configService.get<string>('AI_PROVIDER') ??
          (configService.get<string>('NODE_ENV') === 'production'
            ? 'anthropic'
            : 'ollama');

        if (provider === 'anthropic') {
          return new AnthropicProvider(configService);
        }
        if (provider === 'ollama') {
          return new OllamaProvider(configService);
        }
        if (provider === 'cursor') {
          return new CursorProvider(configService);
        }

        throw new Error(
          `Unsupported AI_PROVIDER="${provider}". Use ollama | anthropic | cursor.`,
        );
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
