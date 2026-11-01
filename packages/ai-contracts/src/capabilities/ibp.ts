import { z } from 'zod';

export const ibpGenerationInputSchema = z.object({
  influencer: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    niche: z.string().nullable().optional(),
    platforms: z.array(z.string()).optional(),
    audienceSize: z.number().nullable().optional(),
    audienceLocation: z.string().nullable().optional(),
    contentStyle: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
});

export type IbpGenerationInput = z.infer<typeof ibpGenerationInputSchema>;

export const ibpGenerationOutputSchema = z.object({
  targetSectors: z.array(z.string()),
  excludedSectors: z.array(z.string()),
  brandSize: z.array(z.string()),
  markets: z.array(z.string()),
  collaborationTypes: z.array(z.string()),
  summary: z.string(),
  alertSignals: z.array(z.string()),
  desirableCriteria: z.array(z.string()),
});

export type IbpGenerationOutput = z.infer<typeof ibpGenerationOutputSchema>;

/** IBP criteria snapshot sent into Brand Discovery plan/score. */
export const ibpCriteriaSnapshotSchema = z.object({
  targetSectors: z.array(z.string()),
  excludedSectors: z.array(z.string()),
  brandSize: z.array(z.string()),
  markets: z.array(z.string()),
  collaborationTypes: z.array(z.string()),
  summary: z.string(),
  alertSignals: z.array(z.string()),
  desirableCriteria: z.array(z.string()),
});

export type IbpCriteriaSnapshot = z.infer<typeof ibpCriteriaSnapshotSchema>;
