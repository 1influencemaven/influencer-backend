import { ConfigService } from '@nestjs/config';

import { parseLeadDiscoveryPlan } from '../schemas/lead-discovery-plan.schema';
import {
  isLoopbackOrDockerHost,
  normalizeOllamaBaseUrl,
  OllamaProvider,
} from './ollama.provider';

describe('OllamaProvider', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  function config(
    values: Record<string, string | number | undefined> = {},
  ): ConfigService {
    const map: Record<string, string | number | undefined> = {
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      OLLAMA_MODEL: 'llama3.2:3b',
      OLLAMA_TIMEOUT_MS: 5000,
      ...values,
    };
    return {
      get: (key: string) => map[key],
    } as unknown as ConfigService;
  }

  it('POSTs to /api/chat with format json and returns message content', async () => {
    const plan = {
      scraperIds: ['gd_people'],
      priorityRoles: ['CEO', 'CMO'],
      notes: 'ok',
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          message: { role: 'assistant', content: JSON.stringify(plan) },
        }),
    });

    const provider = new OllamaProvider(config());
    const raw = await provider.complete('lead discovery plan prompt');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"format":"json"'),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('llama3.2:3b');
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toContain('lead discovery plan prompt');
    expect(parseLeadDiscoveryPlan(raw)).toEqual(
      expect.objectContaining({
        scraperIds: ['gd_people'],
        priorityRoles: ['CEO', 'CMO'],
      }),
    );
    expect(provider.name).toBe('ollama');
  });

  it('maps timeout to a clear error', async () => {
    const err = new Error('aborted');
    err.name = 'TimeoutError';
    fetchMock.mockRejectedValue(err);

    const provider = new OllamaProvider(config({ OLLAMA_TIMEOUT_MS: 1500 }));
    await expect(provider.complete('x')).rejects.toThrow(
      /Ollama request timed out after 1500ms/,
    );
  });

  it('maps connection refused to service unavailable', async () => {
    const err = new Error('fetch failed');
    err.name = 'TypeError';
    (err as Error & { cause: { code: string } }).cause = {
      code: 'ECONNREFUSED',
    };
    fetchMock.mockRejectedValue(err);

    const provider = new OllamaProvider(config());
    await expect(provider.complete('x')).rejects.toThrow(
      /Ollama service unavailable/,
    );
  });

  it('maps HTTP 404 / model missing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'model "llama3.2:3b" not found',
    });

    const provider = new OllamaProvider(config());
    await expect(provider.complete('x')).rejects.toThrow(
      /Ollama model not available: llama3\.2:3b/,
    );
  });

  it('rejects invalid JSON envelope from Ollama', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not-json',
    });

    const provider = new OllamaProvider(config());
    await expect(provider.complete('x')).rejects.toThrow(
      /Ollama response was not valid JSON/,
    );
  });

  it('rejects empty message content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ message: { content: '  ' } }),
    });

    const provider = new OllamaProvider(config());
    await expect(provider.complete('x')).rejects.toThrow(
      /did not contain message content/,
    );
  });
});

describe('OllamaProvider helpers', () => {
  it('normalizes trailing slash on base URL', () => {
    expect(normalizeOllamaBaseUrl('http://127.0.0.1:11434/')).toBe(
      'http://127.0.0.1:11434',
    );
  });

  it('detects loopback and docker host', () => {
    expect(isLoopbackOrDockerHost('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackOrDockerHost('http://host.docker.internal:11434')).toBe(
      true,
    );
    expect(isLoopbackOrDockerHost('http://ollama.example.com:11434')).toBe(
      false,
    );
  });
});

describe('AI provider selection (factory contract)', () => {
  it('constructing OllamaProvider never requires Cursor or Anthropic keys', () => {
    const configService = {
      get: (key: string) => {
        if (key === 'OLLAMA_BASE_URL') return 'http://127.0.0.1:11434';
        if (key === 'OLLAMA_MODEL') return 'llama3.2:3b';
        if (key === 'CURSOR_API_KEY' || key === 'ANTHROPIC_API_KEY') {
          throw new Error(`${key} should not be read for ollama`);
        }
        return undefined;
      },
      getOrThrow: (key: string) => {
        throw new Error(`getOrThrow(${key}) must not run for ollama`);
      },
    } as unknown as ConfigService;

    expect(() => new OllamaProvider(configService)).not.toThrow();
  });
});
