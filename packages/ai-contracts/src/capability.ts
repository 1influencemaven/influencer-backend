import { z } from 'zod';

export const aiCapabilityTypeSchema = z.enum([
  'IBP_GENERATION',
  'BRAND_DISCOVERY',
  'LEAD_DISCOVERY',
  'CONTACT_RESEARCH',
]);

export type AiCapabilityType = z.infer<typeof aiCapabilityTypeSchema>;
