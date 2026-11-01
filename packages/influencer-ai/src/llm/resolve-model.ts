import { createOllama } from 'ollama-ai-provider-v2';

import type { InfluencerAiEnv } from '../config/env';

/**
 * Resolve Mastra Agent `model` from env (ADR-0007 / DEC-001).
 * Ollama: AI SDK provider instance. Anthropic: Mastra model router string.
 * Return type is intentionally wide so declaration emit does not leak
 * nested `@ai-sdk/provider` types from ollama-ai-provider-v2.
 */
export function resolveMastraModel(env: InfluencerAiEnv): string | object {
  if (env.aiProvider === 'anthropic') {
    return `anthropic/${env.anthropicModel}`;
  }

  // ollama-ai-provider expects .../api base URL
  const base = env.ollamaBaseUrl.replace(/\/$/, '');
  const baseURL = base.endsWith('/api') ? base : `${base}/api`;
  const ollama = createOllama({ baseURL });
  return ollama(env.ollamaModel) as object;
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
