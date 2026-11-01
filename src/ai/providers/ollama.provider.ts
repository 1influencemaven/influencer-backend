import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { LlmProvider } from '../interfaces/llm-provider.interface';

type OllamaChatResponse = {
  message?: {
    role?: string;
    content?: string;
  };
  error?: string;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.2:3b';
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Local Ollama adapter (`POST /api/chat`).
 * Intended for development on the same machine (or Docker host bridge).
 * Does not call Cursor or any remote LLM.
 */
@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger = new Logger(OllamaProvider.name);

  constructor(private readonly configService: ConfigService) {
    this.model =
      this.configService.get<string>('OLLAMA_MODEL')?.trim() || DEFAULT_MODEL;
    this.baseUrl = normalizeOllamaBaseUrl(
      this.configService.get<string>('OLLAMA_BASE_URL')?.trim() ||
        DEFAULT_BASE_URL,
    );
    const timeoutRaw = this.configService.get<string | number>(
      'OLLAMA_TIMEOUT_MS',
    );
    const timeoutParsed = Number(timeoutRaw);
    this.timeoutMs =
      Number.isFinite(timeoutParsed) && timeoutParsed >= 1000
        ? timeoutParsed
        : DEFAULT_TIMEOUT_MS;

    if (!isLoopbackOrDockerHost(this.baseUrl)) {
      this.logger.warn(
        `OLLAMA_BASE_URL host is not loopback/docker-host (${new URL(this.baseUrl).hostname}). Keep Ollama off the public Internet.`,
      );
    }
  }

  async complete(prompt: string): Promise<string> {
    this.logger.debug(
      `Calling Ollama model ${this.model} at ${this.baseUrl}/api/chat`,
    );

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: 'json',
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw mapOllamaTransportError(error, this.timeoutMs);
    }

    const rawText = await response.text();

    if (!response.ok) {
      throw mapOllamaHttpError(response.status, rawText, this.model);
    }

    let payload: OllamaChatResponse;
    try {
      payload = JSON.parse(rawText) as OllamaChatResponse;
    } catch {
      throw new Error('Ollama response was not valid JSON');
    }

    if (typeof payload.error === 'string' && payload.error.trim()) {
      throw mapOllamaHttpError(404, payload.error, this.model);
    }

    const content = payload.message?.content?.trim();
    if (!content) {
      throw new Error('Ollama response did not contain message content');
    }

    return content;
  }
}

export function normalizeOllamaBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid OLLAMA_BASE_URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('OLLAMA_BASE_URL must use http or https');
  }
  return trimmed;
}

export function isLoopbackOrDockerHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '::1' ||
      host === 'host.docker.internal'
    );
  } catch {
    return false;
  }
}

function mapOllamaTransportError(error: unknown, timeoutMs: number): Error {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const lower = `${name} ${message}`.toLowerCase();
  const cause =
    error instanceof Error && error.cause && typeof error.cause === 'object'
      ? (error.cause as { code?: string })
      : undefined;

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    lower.includes('timeout') ||
    lower.includes('aborted')
  ) {
    return new Error(`Ollama request timed out after ${timeoutMs}ms`);
  }

  if (
    cause?.code === 'ECONNREFUSED' ||
    lower.includes('econnrefused') ||
    lower.includes('fetch failed')
  ) {
    return new Error(
      'Ollama service unavailable (connection refused or fetch failed)',
    );
  }

  return error instanceof Error
    ? error
    : new Error(`Ollama request failed: ${message}`);
}

function mapOllamaHttpError(
  status: number,
  body: string,
  model: string,
): Error {
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 180);
  const lower = snippet.toLowerCase();

  if (
    status === 404 ||
    lower.includes('not found') ||
    (lower.includes('model') && lower.includes('not'))
  ) {
    return new Error(`Ollama model not available: ${model}`);
  }

  return new Error(
    snippet
      ? `Ollama HTTP ${status}: ${snippet}`
      : `Ollama HTTP ${status}`,
  );
}
