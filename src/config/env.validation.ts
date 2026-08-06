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

  AI_PROVIDER: Joi.string().valid('cursor', 'anthropic').optional(),

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

  BRAND_SOURCE: Joi.string().valid('tavily').default('tavily'),

  // Brand Discovery: solo Tavily. Bright Data se reserva a Lead Discovery.
  TAVILY_API_KEY: Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.optional().allow(''),
    otherwise: Joi.required(),
  }),

  BRIGHTDATA_API_KEY: Joi.string().optional().allow(''),

  BRIGHTDATA_DATASET_ID: Joi.string().optional().allow(''),

  BRIGHTDATA_ZONE: Joi.string().optional().allow(''),

  LEAD_DISCOVERY_LIMIT: Joi.number().integer().min(1).max(20).default(10),

  APOLLO_API_KEY: Joi.string().optional().allow(''),

  BRAND_DISCOVERY_LIMIT: Joi.number().integer().min(1).max(20).default(20),
});
