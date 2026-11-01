import { ConfigService } from '@nestjs/config';

import { AnthropicProvider } from './providers/anthropic.provider';
import { CursorProvider } from './providers/cursor.provider';
import { MockLlmProvider } from './providers/mock-llm.provider';
import { OllamaProvider } from './providers/ollama.provider';

/**
 * Mirrors AiModule LLM factory selection without booting Nest.
 * Ensures ollama does not construct Cursor/Anthropic.
 */
function selectProvider(configService: ConfigService) {
  if (configService.get<string>('NODE_ENV') === 'test') {
    return new MockLlmProvider();
  }

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
  throw new Error(`Unsupported AI_PROVIDER="${provider}"`);
}

describe('AiModule provider selection', () => {
  it('defaults to ollama outside production/test', () => {
    const configService = {
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'OLLAMA_BASE_URL') return 'http://127.0.0.1:11434';
        if (key === 'OLLAMA_MODEL') return 'llama3.2:3b';
        return undefined;
      },
      getOrThrow: (key: string) => {
        throw new Error(`unexpected getOrThrow(${key})`);
      },
    } as unknown as ConfigService;

    const selected = selectProvider(configService);
    expect(selected.name).toBe('ollama');
  });

  it('selects anthropic for production default', () => {
    const configService = {
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      },
      getOrThrow: (key: string) => {
        if (key === 'ANTHROPIC_API_KEY') return 'test-key-not-real';
        throw new Error(`unexpected getOrThrow(${key})`);
      },
    } as unknown as ConfigService;

    const selected = selectProvider(configService);
    expect(selected.name).toBe('anthropic');
  });

  it('AI_PROVIDER=ollama does not read Cursor or Anthropic secrets', () => {
    const configService = {
      get: (key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'AI_PROVIDER') return 'ollama';
        if (key === 'OLLAMA_BASE_URL') return 'http://127.0.0.1:11434';
        if (key === 'OLLAMA_MODEL') return 'llama3.2:3b';
        return undefined;
      },
      getOrThrow: (key: string) => {
        throw new Error(`unexpected getOrThrow(${key})`);
      },
    } as unknown as ConfigService;

    expect(selectProvider(configService).name).toBe('ollama');
  });

  it('uses mock when NODE_ENV=test', () => {
    const configService = {
      get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined),
      getOrThrow: () => {
        throw new Error('unexpected');
      },
    } as unknown as ConfigService;

    expect(selectProvider(configService).name).toBe('mock');
  });
});
