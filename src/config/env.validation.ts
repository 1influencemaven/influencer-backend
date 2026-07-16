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

  CURSOR_API_KEY: Joi.string().when('AI_PROVIDER', {
    is: 'cursor',
    then: Joi.required(),
    otherwise: Joi.when('NODE_ENV', {
      is: 'development',
      then: Joi.optional(),
      otherwise: Joi.optional(),
    }),
  }),

  CURSOR_MODEL: Joi.string().default('composer-2.5'),

  ANTHROPIC_API_KEY: Joi.string().when('AI_PROVIDER', {
    is: 'anthropic',
    then: Joi.required(),
    otherwise: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.optional(),
      otherwise: Joi.optional(),
    }),
  }),

  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-4-20250514'),
});
