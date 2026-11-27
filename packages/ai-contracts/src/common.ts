import { z } from 'zod';

import { AI_CONTRACT_VERSION } from './version';

export const contractVersionSchema = z.literal(AI_CONTRACT_VERSION);

export const isoDateTimeSchema = z.string().datetime();

export const uuidSchema = z.string().uuid();

export const aiLlmProviderIdSchema = z.enum(['ollama', 'anthropic', 'mock']);

export type AiLlmProviderId = z.infer<typeof aiLlmProviderIdSchema>;

export const aiLlmConfigurationSchema = z.object({
  provider: aiLlmProviderIdSchema,
  model: z.string().min(1),
});

export type AiLlmConfiguration = z.infer<typeof aiLlmConfigurationSchema>;

export const aiInstructionsSchema = z.object({
  /** Editable business instructions snapshot (empty/omitted → worker default). */
  business: z.string().default(''),
  businessHash: z.string().optional(),
});

export type AiInstructions = z.infer<typeof aiInstructionsSchema>;

export const aiExecutionLimitsSchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  maxLlmCalls: z.number().int().positive().optional(),
  maxSerpQueries: z.number().int().positive().optional(),
  maxPages: z.number().int().positive().optional(),
  maxIterations: z.number().int().positive().optional(),
});

export type AiExecutionLimits = z.infer<typeof aiExecutionLimitsSchema>;

export const aiResourceTypeSchema = z.enum([
  'IDEAL_BRAND_PROFILE',
  'BRAND_DISCOVERY_RUN',
  'LEAD_DISCOVERY_RUN',
  'CONTACT_RESEARCH_RUN',
]);

export type AiResourceType = z.infer<typeof aiResourceTypeSchema>;

export const aiExecutionContextSchema = z.object({
  userId: z.string().min(1),
  influencerId: z.string().min(1).optional(),
  resourceId: z.string().min(1),
  resourceType: aiResourceTypeSchema,
  locale: z.enum(['es', 'en']).optional(),
  actorRole: z.enum(['USER', 'ADMIN']).optional(),
});

export type AiExecutionContext = z.infer<typeof aiExecutionContextSchema>;

export const aiResultMetadataSchema = z.object({
  provider: z.union([aiLlmProviderIdSchema, z.string()]).optional(),
  model: z.string().optional(),
  llmCallCount: z.number().int().nonnegative().optional(),
  promptBusinessHash: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

export type AiResultMetadata = z.infer<typeof aiResultMetadataSchema>;
