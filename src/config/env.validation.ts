// src/config/env.validation.ts

import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),

  PORT: Joi.number().default(3000),

  FRONTEND_URL: Joi.string().uri().required(),

  DATABASE_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().required(),

  JWT_REFRESH_SECRET: Joi.string().required(),

  JWT_ACCESS_EXPIRES_IN: Joi.string().required(),

  JWT_REFRESH_EXPIRES_IN: Joi.string().required(),

  REDIS_HOST: Joi.string().required(),

  REDIS_PORT: Joi.number().required(),

  REDIS_PASSWORD: Joi.string().allow('').optional(),

  REDIS_DB: Joi.number().required(),

  SWAGGER_ENABLED: Joi.boolean().required(),

  THROTTLE_TTL: Joi.number().required(),

  THROTTLE_LIMIT: Joi.number().required(),

  AI_PROVIDER: Joi.string().valid('ollama', 'anthropic', 'cursor').optional(),

  // La key solo es obligatoria (y no vacía) cuando su proveedor es el activo.
  // Docker Compose pasa las variables no definidas como cadena vacía, por lo
  // que el proveedor inactivo debe aceptar '' para no bloquear el arranque.
  CURSOR_API_KEY: Joi.string().when('AI_PROVIDER', {
    is: 'cursor',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),

  CURSOR_MODEL: Joi.string().default('composer-2.5'),

  ANTHROPIC_API_KEY: Joi.string().when('AI_PROVIDER', {
    is: 'anthropic',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),

  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-4-20250514'),

  // Local Ollama — no API key. Defaults suit host-run Nest (not containerized app).
  OLLAMA_BASE_URL: Joi.string().uri().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: Joi.string().default('llama3.2:3b'),
  OLLAMA_TIMEOUT_MS: Joi.number().integer().min(1000).default(120000),

  // Brand Discovery search-query planning: llm (default) or deterministic templates.
  // Source is always Bright Data SERP (registry id `brightdata`); no BRAND_SOURCE env (BD-01.e).
  BRAND_SEARCH_STRATEGY: Joi.string().valid('llm', 'templates').default('llm'),

  /**
   * Brand Discovery LLM engine (AI-004.4.6).
   * - legacy (default): AiPlusTavilyBrandSource + Nest AiService
   * - mastra: BrandDiscoveryAiOrchestrator (BullMQ → influencer-ai)
   * No automatic fallback between engines.
   */
  BRAND_DISCOVERY_ENGINE: Joi.string()
    .valid('legacy', 'mastra')
    .default('legacy'),

  /**
   * P1b geographic SERP lenses.
   * - legacy (default): single resolveSerpGeo per run (pre-P1b).
   * - v1: multi-lens query×market under BRAND_DISCOVERY_MAX_SERP_CALLS.
   */
  BRAND_DISCOVERY_GEO_LENSES: Joi.string()
    .valid('legacy', 'v1')
    .default('legacy'),

  /** Hard cap on Bright Data SERP calls per Brand Discovery run (P1b v1). */
  BRAND_DISCOVERY_MAX_SERP_CALLS: Joi.number()
    .integer()
    .min(1)
    .max(24)
    .default(12),

  /**
   * Comma-separated countries or gl codes that represent LATAM when IBP.markets
   * includes LATAM. Empty = do not expand (never invent Mexico-as-LATAM).
   * Examples: Mexico,Colombia,Argentina  |  mx,co,ar
   */
  BRAND_DISCOVERY_REGION_LATAM_COUNTRIES: Joi.string().optional().allow(''),

  /**
   * Optional Europe region expansion (same format as LATAM).
   * Empty = do not expand Europe → a single proxy country.
   */
  BRAND_DISCOVERY_REGION_EUROPE_COUNTRIES: Joi.string().optional().allow(''),

  /** Max concurrent brand deep-research jobs per discovery run (mastra). */
  BRAND_DISCOVERY_RESEARCH_CONCURRENCY: Joi.number()
    .integer()
    .min(1)
    .max(5)
    .default(2),

  /** Concurrent Bright Data SERP calls per Brand Discovery run (1 = sequential). */
  BRAND_DISCOVERY_SERP_CONCURRENCY: Joi.number().integer().min(1).max(8).default(4),

  /** Min validated SERP queries before the plan is topped up from the IBP taxonomy (0 = off). */
  BRAND_DISCOVERY_MIN_QUERIES: Joi.number().integer().min(0).max(12).default(6),
  /** Max SERP queries after the top-up. */
  BRAND_DISCOVERY_MAX_QUERIES: Joi.number().integer().min(1).max(12).default(8),
  /** Max filtered SERP hits sent to SCORE_CANDIDATES (bounds local-LLM time). */
  BRAND_DISCOVERY_MAX_SCORE_HITS: Joi.number().integer().min(1).max(100).default(30),
  /** Hits per SCORE_CANDIDATES call (smaller = faster calls, partial results survive a failure). */
  BRAND_DISCOVERY_SCORE_BATCH_SIZE: Joi.number().integer().min(1).max(100).default(10),
  /** Wait timeout for SCORE_CANDIDATES Mastra result (ms). Raise for CPU-only local models. */
  BRAND_DISCOVERY_SCORE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(30000)
    .max(1800000)
    .default(300000),

  /**
   * Multi-brand retailers (Sephora, Ulta, Nordstrom, Target...) in Brand Discovery results:
   * demote (default) = persist after brand-owned candidates; exclude = never persist; off = no special handling.
   */
  BRAND_DISCOVERY_RETAILER_POLICY: Joi.string()
    .valid('demote', 'exclude', 'off')
    .default('demote'),

  /** Deep research per brand (Unlocker + RESEARCH_BRAND). Turn off for CPU-only local models. */
  BRAND_DISCOVERY_RESEARCH_ENABLED: Joi.boolean().default(true),

  /** Wait timeout for RESEARCH_BRAND Mastra result (ms). */
  BRAND_DISCOVERY_RESEARCH_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(300000),

  BRIGHTDATA_API_KEY: Joi.string().optional().allow(''),

  BRIGHTDATA_DATASET_ID: Joi.string().optional().allow(''),

  /** Talent Manager Instagram Profiles dataset (default gd_l1vikfch901nx3by4). */
  BRIGHTDATA_INSTAGRAM_PROFILE_DATASET_ID: Joi.string().optional().allow(''),

  /**
   * @deprecated BD-01.f — legacy alias for Unlocker only.
   * Prefer `BRIGHTDATA_UNLOCKER_ZONE`. Still accepted for bootstrap of old `.env`.
   * Runtime precedence (BrightDataSearchClient): UNLOCKER_ZONE → ZONE → default `mcp_unlocker`.
   * Not a SERP zone. Removal requires a later approved phase.
   */
  BRIGHTDATA_ZONE: Joi.string().optional().allow(''),

  /** SERP API zone — must NOT be the Unlocker zone. Required for search(). */
  BRIGHTDATA_SERP_ZONE: Joi.string().optional().allow(''),

  /** Canonical Web Unlocker zone for fetchRawHtml() — default `mcp_unlocker` if unset (and ZONE unset). */
  BRIGHTDATA_UNLOCKER_ZONE: Joi.string().optional().allow(''),

  /** Demo caps for AI-orchestrated contact research (P0). */
  /** Caps forwarded to Mastra FIND_BRAND_EMAILS (influencer-ai). */
  AI_RESEARCH_MAX_SERP_QUERIES: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .default(5),
  AI_RESEARCH_MAX_PAGES: Joi.number().integer().min(1).max(20).default(5),

  /** Caps forwarded to Mastra FIND_BRAND_PEOPLE (Track 2B). */
  AI_PEOPLE_MAX_SERP_QUERIES: Joi.number()
    .integer()
    .min(1)
    .max(12)
    .default(4),
  AI_PEOPLE_MAX_PROFILES: Joi.number().integer().min(1).max(15).default(5),
  AI_PEOPLE_MAX_BRAND_PAGES: Joi.number().integer().min(1).max(12).default(6),
  /** When true, Nest asks worker to attempt OCR after LinkedIn+PEE (Phase 2). */
  CONTACT_OCR_ENABLED: Joi.boolean().default(false),

  BRIGHTDATA_SEARCH_TIMEOUT_MS: Joi.number().integer().min(1000).default(60000),

  BRIGHTDATA_SEARCH_MAX_RETRIES: Joi.number()
    .integer()
    .min(0)
    .max(5)
    .default(2),

  BRIGHTDATA_SEARCH_RETRY_BACKOFF_MS: Joi.number()
    .integer()
    .min(0)
    .default(1500),

  BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: Joi.number()
    .integer()
    .min(5000)
    .default(120000),

  BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: Joi.number()
    .integer()
    .min(500)
    .default(3000),

  MAX_BRAND_BUSINESS_CONTACT_PAGES: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .default(12),

  MAX_BRAND_BUSINESS_CONTACTS: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(15),

  LEAD_DISCOVERY_LIMIT: Joi.number().integer().min(1).max(20).default(10),

  APOLLO_API_KEY: Joi.string().optional().allow(''),

  BRAND_DISCOVERY_LIMIT: Joi.number().integer().min(1).max(20).default(20),

  // ADMIN Unlocker diagnostic probe (local only; ignored / forbidden in production).
  UNLOCKER_DIAGNOSTICS_ENABLED: Joi.boolean().default(false),
});
