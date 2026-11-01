export type InfluencerAiEnv = {
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  redisDb: number;
  aiProvider: 'ollama' | 'anthropic';
  ollamaBaseUrl: string;
  ollamaModel: string;
  anthropicApiKey?: string;
  anthropicModel: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

export function loadInfluencerAiEnv(): InfluencerAiEnv {
  const aiProvider =
    (process.env.AI_PROVIDER as 'ollama' | 'anthropic' | undefined) ?? 'ollama';

  if (aiProvider !== 'ollama' && aiProvider !== 'anthropic') {
    throw new Error(
      `influencer-ai supports AI_PROVIDER=ollama|anthropic (got "${aiProvider}")`,
    );
  }

  return {
    redisHost: process.env.REDIS_HOST ?? '127.0.0.1',
    redisPort: Number(process.env.REDIS_PORT ?? '6379'),
    redisPassword: process.env.REDIS_PASSWORD || undefined,
    redisDb: Number(process.env.REDIS_DB ?? '0'),
    aiProvider,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.2:3b',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    anthropicModel:
      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
  };
}

export function assertProviderReady(env: InfluencerAiEnv): void {
  if (env.aiProvider === 'anthropic' && !env.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic');
  }
  void required;
}
