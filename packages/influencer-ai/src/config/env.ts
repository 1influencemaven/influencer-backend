export type InfluencerAiEnv = {
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  redisDb: number;
  aiProvider: 'ollama' | 'anthropic';
  ollamaBaseUrl: string;
  ollamaModel: string;
  /**
   * Max wait for an Ollama response (headers + body). CPU-only local models can
   * take minutes to answer a non-streaming request; undici's default is 300 s.
   */
  ollamaRequestTimeoutMs: number;
  /** Ollama silently truncates prompts beyond the context window (default 4096). */
  ollamaNumCtx: number;
  /** Output token cap; stops runaway generations when the model loses the format. */
  ollamaNumPredict: number;
  ollamaKeepAlive?: string;
  /** Parallel ai.execution jobs (AI_WORKER_CONCURRENCY, default 8). */
  workerConcurrency: number;
  anthropicApiKey?: string;
  anthropicModel: string;
  /** Bright Data — Contact Research (FIND_BRAND_* / FIND_AGENCY_EMAILS). */
  brightDataApiKey?: string;
  brightDataSerpZone?: string;
  brightDataUnlockerZone?: string;
  brightDataTimeoutMs: number;
  /** LinkedIn people profiles dataset (Track 2B scrape). */
  brightDataLinkedInPeopleDatasetId: string;
  brightDataScraperPollTimeoutMs: number;
  brightDataScraperPollIntervalMs: number;
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
    ollamaRequestTimeoutMs: Number(
      process.env.OLLAMA_REQUEST_TIMEOUT_MS ?? '1200000',
    ),
    ollamaNumCtx: Number(process.env.OLLAMA_NUM_CTX ?? '8192'),
    ollamaNumPredict: Number(process.env.OLLAMA_NUM_PREDICT ?? '3072'),
    ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE?.trim() || undefined,
    workerConcurrency: Math.max(
      1,
      Number(process.env.AI_WORKER_CONCURRENCY ?? '8') || 8,
    ),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    anthropicModel:
      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
    brightDataApiKey: process.env.BRIGHTDATA_API_KEY?.trim() || undefined,
    brightDataSerpZone: process.env.BRIGHTDATA_SERP_ZONE?.trim() || undefined,
    brightDataUnlockerZone:
      process.env.BRIGHTDATA_UNLOCKER_ZONE?.trim() ||
      process.env.BRIGHTDATA_ZONE?.trim() ||
      undefined,
    brightDataTimeoutMs: Number(
      process.env.BRIGHTDATA_SEARCH_TIMEOUT_MS ?? '45000',
    ),
    brightDataLinkedInPeopleDatasetId:
      process.env.BRIGHTDATA_LINKEDIN_PEOPLE_DATASET_ID?.trim() ||
      'gd_l1viktl72bvl7bjuj0',
    brightDataScraperPollTimeoutMs: Number(
      process.env.BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS ?? '120000',
    ),
    brightDataScraperPollIntervalMs: Number(
      process.env.BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS ?? '3000',
    ),
  };
}

export function assertProviderReady(env: InfluencerAiEnv): void {
  if (env.aiProvider === 'anthropic' && !env.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic');
  }
  void required;
}
