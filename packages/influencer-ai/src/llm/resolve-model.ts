import { createOllama } from 'ollama-ai-provider-v2';
import { Agent, fetch as undiciFetch } from 'undici';

import type { InfluencerAiEnv } from '../config/env';

/**
 * Resolve Mastra Agent `model` from env (ADR-0007 / DEC-001).
 * Ollama: AI SDK provider instance. Anthropic: Mastra model router string.
 * Return type is intentionally wide so declaration emit does not leak
 * nested `@ai-sdk/provider` types from ollama-ai-provider-v2.
 */
/**
 * Fetch for the Ollama provider with a long header/body timeout. A local model
 * on CPU sends no response headers until a non-streaming completion is done, so
 * undici's 300 s default aborted long SCORE_CANDIDATES calls (and the AI SDK
 * then retried them, burning 3 x 300 s).
 */
export function createOllamaFetch(timeoutMs: number): typeof fetch {
  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  return ((input: unknown, init?: Record<string, unknown>) =>
    undiciFetch(input as never, { ...init, dispatcher } as never)) as never;
}

export function resolveMastraModel(env: InfluencerAiEnv): string | object {
  if (env.aiProvider === 'anthropic') {
    return `anthropic/${env.anthropicModel}`;
  }

  // ollama-ai-provider expects .../api base URL
  const base = env.ollamaBaseUrl.replace(/\/$/, '');
  const baseURL = base.endsWith('/api') ? base : `${base}/api`;
  const ollama = createOllama({
    baseURL,
    fetch: withOllamaDefaults(
      env,
      createOllamaFetch(env.ollamaRequestTimeoutMs),
    ),
  });
  return ollama(env.ollamaModel) as object;
}

/**
 * Injects num_ctx / num_predict / keep_alive into every Ollama request so all
 * agents share them; per-call options still win.
 */
export function withOllamaDefaults(
  env: Pick<
    InfluencerAiEnv,
    'ollamaNumCtx' | 'ollamaNumPredict' | 'ollamaKeepAlive'
  >,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== 'string') return baseFetch(input, init);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return baseFetch(input, init);
    }
    body.options = {
      num_ctx: env.ollamaNumCtx,
      num_predict: env.ollamaNumPredict,
      ...((body.options as Record<string, unknown> | undefined) ?? {}),
    };
    if (env.ollamaKeepAlive && body.keep_alive === undefined) {
      body.keep_alive = env.ollamaKeepAlive;
    }
    return baseFetch(input, { ...init, body: JSON.stringify(body) });
  };
}

export function resolveProviderMeta(env: InfluencerAiEnv): {
  provider: 'ollama' | 'anthropic';
  model: string;
} {
  if (env.aiProvider === 'anthropic') {
    return { provider: 'anthropic', model: env.anthropicModel };
  }
  return { provider: 'ollama', model: env.ollamaModel };
}
