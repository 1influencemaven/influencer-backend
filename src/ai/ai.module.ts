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
    {
      provide: LLM_PROVIDER_TOKEN,
      inject: [ConfigService],
      // Instanciación perezosa: solo se construye el provider seleccionado.
      // Los constructores hacen getOrThrow de su API key, así que registrar
      // todos como providers de Nest exigiría tener todas las keys definidas.
      useFactory: (configService: ConfigService) => {
        if (configService.get<string>('NODE_ENV') === 'test') {
          return new MockLlmProvider();
        }

        // TEMPORAL: producción usa Cursor (AI_PROVIDER=cursor) mientras se
        // adquiere Claude (Anthropic). Al tener la key, basta con definir
        // AI_PROVIDER=anthropic y ANTHROPIC_API_KEY en el entorno; el default
        // por ambiente ya apunta a anthropic en producción.
        const provider =
          configService.get<string>('AI_PROVIDER') ??
          (configService.get<string>('NODE_ENV') === 'production'
            ? 'anthropic'
            : 'cursor');

        if (provider === 'anthropic') {
          return new AnthropicProvider(configService);
        }

        return new CursorProvider(configService);
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
