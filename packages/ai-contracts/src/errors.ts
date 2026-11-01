import { z } from 'zod';

export const aiErrorCodeSchema = z.enum([
  'AI_PROVIDER_ERROR',
  'AI_INVALID_OUTPUT',
  'AI_EXECUTION_TIMEOUT',
  'AI_CONTEXT_INVALID',
  'AI_TOOL_ERROR',
  'AI_EXECUTION_CANCELLED',
  'AI_INTERNAL_ERROR',
]);

export type AiErrorCode = z.infer<typeof aiErrorCodeSchema>;

export const aiErrorSchema = z.object({
  code: aiErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  occurredAt: z.string().datetime(),
});

export type AiError = z.infer<typeof aiErrorSchema>;
