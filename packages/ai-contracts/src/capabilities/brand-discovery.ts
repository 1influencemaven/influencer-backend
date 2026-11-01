import { z } from 'zod';

import { ibpCriteriaSnapshotSchema } from './ibp';

const searchHitSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string().optional(),
});

const seedBrandSchema = z.object({
  name: z.string().min(1),
  website: z.string().min(1),
  sector: z.string().optional(),
  market: z.string().optional(),
  brandSize: z.string().optional(),
  evidenceUrls: z.array(z.string()).optional(),
});

export const brandDiscoveryInputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('PLAN_SEARCH'),
    influencerName: z.string().min(1),
    niche: z.string().nullable().optional(),
    ibp: ibpCriteriaSnapshotSchema,
    maxQueries: z.number().int().positive(),
  }),
  z.object({
    operation: z.literal('SCORE_CANDIDATES'),
    influencerName: z.string().min(1),
    niche: z.string().nullable().optional(),
    ibp: ibpCriteriaSnapshotSchema,
    limit: z.number().int().positive(),
    searchHits: z.array(searchHitSchema),
    seedBrands: z.array(seedBrandSchema).optional(),
  }),
]);

export type BrandDiscoveryInput = z.infer<typeof brandDiscoveryInputSchema>;

export const scoredBrandSchema = z.object({
  name: z.string().min(1),
  website: z.string().min(1),
  sector: z.string().optional(),
  market: z.string().optional(),
  brandSize: z.string().optional(),
  score: z.number().min(0).max(100),
  fitReason: z.string().min(1),
  evidenceUrls: z.array(z.string()),
});

export const brandDiscoveryOutputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('PLAN_SEARCH'),
    queries: z.array(z.string().min(1)),
  }),
  z.object({
    operation: z.literal('SCORE_CANDIDATES'),
    brands: z.array(scoredBrandSchema),
  }),
]);

export type BrandDiscoveryOutput = z.infer<typeof brandDiscoveryOutputSchema>;
export type ScoredBrand = z.infer<typeof scoredBrandSchema>;
