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

  BRIGHTDATA_API_KEY: Joi.string().optional().allow(''),

  BRIGHTDATA_DATASET_ID: Joi.string().optional().allow(''),

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

  BRIGHTDATA_SEARCH_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),

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
