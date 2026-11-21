import { z } from 'zod';

import { brandDiscoveryOutputSchema } from './capabilities/brand-discovery';
import { contactResearchOutputSchema } from './capabilities/contact-research';
import { ibpGenerationOutputSchema } from './capabilities/ibp';
import { leadDiscoveryOutputSchema } from './capabilities/lead-discovery';
import {
  aiResultMetadataSchema,
  contractVersionSchema,
  isoDateTimeSchema,
  uuidSchema,
} from './common';
import { aiErrorSchema } from './errors';
import { aiExecutionResultStatusSchema } from './status';

const resultEnvelopeBase = {
  contractVersion: contractVersionSchema,
  executionId: uuidSchema,
  correlationId: uuidSchema,
  metadata: aiResultMetadataSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema,
  durationMs: z.number().nonnegative(),
};

export const aiExecutionResultSchema = z.discriminatedUnion('type', [
  z.object({
    ...resultEnvelopeBase,
    type: z.literal('IBP_GENERATION'),
    status: aiExecutionResultStatusSchema,
    output: ibpGenerationOutputSchema.optional(),
    error: aiErrorSchema.optional(),
  }),
  z.object({
    ...resultEnvelopeBase,
    type: z.literal('BRAND_DISCOVERY'),
    status: aiExecutionResultStatusSchema,
    output: brandDiscoveryOutputSchema.optional(),
    error: aiErrorSchema.optional(),
  }),
  z.object({
    ...resultEnvelopeBase,
    type: z.literal('LEAD_DISCOVERY'),
    status: aiExecutionResultStatusSchema,
    output: leadDiscoveryOutputSchema.optional(),
    error: aiErrorSchema.optional(),
  }),
  z.object({
    ...resultEnvelopeBase,
    type: z.literal('CONTACT_RESEARCH'),
    status: aiExecutionResultStatusSchema,
    output: contactResearchOutputSchema.optional(),
    error: aiErrorSchema.optional(),
  }),
]);

export type AiExecutionResult = z.infer<typeof aiExecutionResultSchema>;

export function parseAiExecutionResult(data: unknown): AiExecutionResult {
  return aiExecutionResultSchema.parse(data);
}
