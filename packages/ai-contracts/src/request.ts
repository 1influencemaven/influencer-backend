import { z } from 'zod';

import { brandDiscoveryInputSchema } from './capabilities/brand-discovery';
import { contactResearchInputSchema } from './capabilities/contact-research';
import { ibpGenerationInputSchema } from './capabilities/ibp';
import { leadDiscoveryInputSchema } from './capabilities/lead-discovery';
import {
  aiExecutionContextSchema,
  aiExecutionLimitsSchema,
  aiInstructionsSchema,
  aiLlmConfigurationSchema,
  contractVersionSchema,
  isoDateTimeSchema,
  uuidSchema,
} from './common';

const requestEnvelopeBase = {
  contractVersion: contractVersionSchema,
  executionId: uuidSchema,
  correlationId: uuidSchema,
  idempotencyKey: z.string().min(1),
  requestedAt: isoDateTimeSchema,
  context: aiExecutionContextSchema,
  instructions: aiInstructionsSchema,
  configuration: aiLlmConfigurationSchema.optional(),
  limits: aiExecutionLimitsSchema.optional(),
};

export const aiExecutionRequestSchema = z.discriminatedUnion('type', [
  z.object({
    ...requestEnvelopeBase,
    type: z.literal('IBP_GENERATION'),
    input: ibpGenerationInputSchema,
  }),
  z.object({
    ...requestEnvelopeBase,
    type: z.literal('BRAND_DISCOVERY'),
    input: brandDiscoveryInputSchema,
  }),
  z.object({
    ...requestEnvelopeBase,
    type: z.literal('LEAD_DISCOVERY'),
    input: leadDiscoveryInputSchema,
  }),
  z.object({
    ...requestEnvelopeBase,
    type: z.literal('CONTACT_RESEARCH'),
    input: contactResearchInputSchema,
  }),
]);

export type AiExecutionRequest = z.infer<typeof aiExecutionRequestSchema>;

export function parseAiExecutionRequest(data: unknown): AiExecutionRequest {
  return aiExecutionRequestSchema.parse(data);
}
