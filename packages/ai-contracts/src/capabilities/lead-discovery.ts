import { z } from 'zod';

export const leadDiscoveryInputSchema = z.object({
  operation: z.literal('PLAN'),
  brandName: z.string().min(1),
  website: z.string().min(1),
  domain: z.string().min(1),
  limit: z.number().int().positive(),
  scraperAllowlist: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .min(1),
});

export type LeadDiscoveryInput = z.infer<typeof leadDiscoveryInputSchema>;

export const leadDiscoveryOutputSchema = z.object({
  operation: z.literal('PLAN'),
  scraperIds: z.array(z.string().min(1)),
  priorityRoles: z.array(z.string().min(1)),
  notes: z.string().optional(),
});

export type LeadDiscoveryOutput = z.infer<typeof leadDiscoveryOutputSchema>;
