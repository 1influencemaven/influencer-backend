import { z } from 'zod';

import { aiCapabilityTypeSchema } from './capability';
import {
  contractVersionSchema,
  isoDateTimeSchema,
  uuidSchema,
} from './common';
import { aiErrorCodeSchema } from './errors';
import { aiExecutionResultStatusSchema } from './status';

export const aiExecutionEventNameSchema = z.enum([
  'ai.execution.accepted',
  'ai.execution.started',
  'ai.execution.progress',
  'ai.execution.completed',
  'ai.execution.failed',
  'ai.execution.cancelled',
]);

export type AiExecutionEventName = z.infer<typeof aiExecutionEventNameSchema>;

export const aiExecutionEventPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('empty'),
  }),
  z.object({
    kind: z.literal('progress'),
    stage: z.enum(['SEARCH', 'FETCH', 'EXTRACT', 'FINALIZE']),
    iteration: z.number().int().positive().optional(),
    serpQueriesUsed: z.number().int().nonnegative().optional(),
    pagesFetched: z.number().int().nonnegative().optional(),
    emailsFoundCount: z.number().int().nonnegative().optional(),
    lastAction: z.string().optional(),
    message: z.string().optional(),
  }),
  z.object({
    kind: z.literal('terminal'),
    status: aiExecutionResultStatusSchema,
    errorCode: aiErrorCodeSchema.optional(),
  }),
]);

export type AiExecutionEventPayload = z.infer<
  typeof aiExecutionEventPayloadSchema
>;

export const aiExecutionEventSchema = z.object({
  contractVersion: contractVersionSchema,
  eventId: uuidSchema,
  executionId: uuidSchema,
  correlationId: uuidSchema,
  type: aiCapabilityTypeSchema,
  name: aiExecutionEventNameSchema,
  occurredAt: isoDateTimeSchema,
  sequence: z.number().int().nonnegative(),
  payload: aiExecutionEventPayloadSchema,
});

export type AiExecutionEvent = z.infer<typeof aiExecutionEventSchema>;

export function parseAiExecutionEvent(data: unknown): AiExecutionEvent {
  return aiExecutionEventSchema.parse(data);
}
