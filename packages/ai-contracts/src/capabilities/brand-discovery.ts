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

/** Profile fields from the Influencer form (optional; additive). */
const brandDiscoveryInfluencerProfileFields = {
  influencerName: z.string().min(1),
  niche: z.string().nullable().optional(),
  subNiche: z.string().nullable().optional(),
  /** Multi-value niches from Talent Manager (additive). */
  niches: z.array(z.string()).optional(),
  country: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  followers: z.number().int().nonnegative().nullable().optional(),
  engagement: z.number().nullable().optional(),
};

/** Field-level finding status for deep research (not Prisma EvidenceStatus). */
export const brandResearchFieldStatusSchema = z.enum([
  'VERIFIED',
  'PARTIAL',
  'NOT_FOUND',
  'UNAVAILABLE',
]);

export type BrandResearchFieldStatus = z.infer<
  typeof brandResearchFieldStatusSchema
>;

export const brandResearchEvidenceRefSchema = z.object({
  url: z.string().min(1),
  excerpt: z.string().max(500).optional(),
  pageRole: z
    .enum(['homepage', 'about', 'products', 'partnerships', 'other'])
    .optional(),
});

export type BrandResearchEvidenceRef = z.infer<
  typeof brandResearchEvidenceRefSchema
>;

/**
 * Optional string that LLMs often emit as `null`.
 * Use preprocess (not transform-only) so inferred output keeps `note?: string`
 * instead of required `note: string | undefined`.
 */
const optionalNoteSchema = z.preprocess(
  (v) => (v == null || v === '' ? undefined : v),
  z.string().optional(),
);

export function researchedFieldSchema<T extends z.ZodType>(valueSchema: T) {
  return z.object({
    value: valueSchema.nullable(),
    status: brandResearchFieldStatusSchema,
    evidence: z.array(brandResearchEvidenceRefSchema),
    note: optionalNoteSchema,
  });
}

export const brandResearchPageRoleSchema = z.enum([
  'homepage',
  'about',
  'products',
  'partnerships',
  'other',
]);

export type BrandResearchPageRole = z.infer<typeof brandResearchPageRoleSchema>;

export const brandPageSnapshotSchema = z.object({
  url: z.string().min(1),
  role: brandResearchPageRoleSchema,
  textContent: z.string().max(20_000),
});

export type BrandPageSnapshot = z.infer<typeof brandPageSnapshotSchema>;

export const brandCommercialSignalKindSchema = z.enum([
  'influencer_marketing',
  'affiliate',
  'creator_program',
  'ambassador',
  'partnerships',
  'sponsorship',
  'ugc',
]);

export type BrandCommercialSignalKind = z.infer<
  typeof brandCommercialSignalKindSchema
>;

/**
 * Traceable commercial signal — not free text.
 * `value` is null when NOT_FOUND / UNAVAILABLE (absence ≠ negative proof).
 */
export const brandCommercialSignalSchema = z.object({
  kind: brandCommercialSignalKindSchema,
  value: z.boolean().nullable(),
  status: brandResearchFieldStatusSchema,
  evidence: z.array(brandResearchEvidenceRefSchema),
  note: optionalNoteSchema,
});

export type BrandCommercialSignal = z.infer<typeof brandCommercialSignalSchema>;

export const brandResearchAgentStatusSchema = z.enum([
  'COMPLETED',
  'PARTIAL',
  'FAILED',
]);

export type BrandResearchAgentStatus = z.infer<
  typeof brandResearchAgentStatusSchema
>;

export const brandResearchedPageSchema = z.object({
  url: z.string().min(1),
  role: brandResearchPageRoleSchema,
  fetchStatus: z.enum([
    'ok',
    'http_error',
    'empty_body',
    'timeout',
    'network_error',
    'skipped',
    'rejected',
  ]),
  httpStatus: z.number().int().optional(),
  errorMessage: z.preprocess(
    (v) => (v == null || v === '' ? undefined : v),
    z.string().max(240).optional(),
  ),
});

export type BrandResearchedPage = z.infer<typeof brandResearchedPageSchema>;

const brandDeepResearchIdentitySchema = z.object({
  name: researchedFieldSchema(z.string()),
  officialWebsite: researchedFieldSchema(z.string()),
  domain: researchedFieldSchema(z.string()),
});

const brandDeepResearchCompanySchema = z.object({
  description: researchedFieldSchema(z.string()),
  brandSize: researchedFieldSchema(z.string()),
});

const brandDeepResearchIndustrySchema = z.object({
  sectors: researchedFieldSchema(z.array(z.string())),
  categories: researchedFieldSchema(z.array(z.string())),
});

const brandDeepResearchOfferingsSchema = z.object({
  productsAndServices: researchedFieldSchema(z.array(z.string())),
});

const brandDeepResearchMarketsSchema = z.object({
  countriesOrRegions: researchedFieldSchema(z.array(z.string())),
});

const brandDeepResearchInfluencerFitSchema = z.object({
  /** Optional — Nest keeps SCORE score when absent/invalid. */
  score: z.number().min(0).max(100).optional(),
  rationale: researchedFieldSchema(z.string()),
  alignmentNotes: researchedFieldSchema(z.array(z.string())).optional(),
});

export const brandDeepResearchOutputBodySchema = z.object({
  researchStatus: brandResearchAgentStatusSchema,
  identity: brandDeepResearchIdentitySchema,
  company: brandDeepResearchCompanySchema,
  industry: brandDeepResearchIndustrySchema,
  offerings: brandDeepResearchOfferingsSchema,
  markets: brandDeepResearchMarketsSchema,
  commercialSignals: z.array(brandCommercialSignalSchema),
  influencerFit: brandDeepResearchInfluencerFitSchema,
  pages: z.array(brandResearchedPageSchema).max(4),
  warnings: z.array(z.string()).optional(),
});

export type BrandDeepResearchOutputBody = z.infer<
  typeof brandDeepResearchOutputBodySchema
>;

/**
 * Lenient Mastra structuredOutput capture for RESEARCH_BRAND.
 * Strict shape is enforced after `normalizeResearchLlmObject` +
 * `brandDeepResearchOutputBodySchema`.
 */
export const brandDeepResearchOutputBodyLlmCaptureSchema = z
  .object({
    researchStatus: z.string().min(1),
    identity: z.unknown(),
    company: z.unknown(),
    industry: z.unknown(),
    offerings: z.unknown(),
    markets: z.unknown(),
    commercialSignals: z.array(z.unknown()).optional().default([]),
    influencerFit: z.unknown(),
    pages: z.array(z.unknown()).optional().default([]),
    warnings: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type BrandDeepResearchOutputBodyLlmCapture = z.infer<
  typeof brandDeepResearchOutputBodyLlmCaptureSchema
>;

export const brandDiscoveryInputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('PLAN_SEARCH'),
    ...brandDiscoveryInfluencerProfileFields,
    ibp: ibpCriteriaSnapshotSchema,
    maxQueries: z.number().int().positive(),
  }),
  z.object({
    operation: z.literal('SCORE_CANDIDATES'),
    ...brandDiscoveryInfluencerProfileFields,
    ibp: ibpCriteriaSnapshotSchema,
    limit: z.number().int().positive(),
    searchHits: z.array(searchHitSchema),
    seedBrands: z.array(seedBrandSchema).optional(),
  }),
  z.object({
    operation: z.literal('RESEARCH_BRAND'),
    ...brandDiscoveryInfluencerProfileFields,
    ibp: ibpCriteriaSnapshotSchema,
    brand: z.object({
      name: z.string().min(1),
      website: z.string().min(1),
      domain: z.string().min(1),
    }),
    pageSnapshots: z.array(brandPageSnapshotSchema).max(4),
    maxPages: z.number().int().positive().max(4).default(4),
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
  z.object({
    operation: z.literal('RESEARCH_BRAND'),
    ...brandDeepResearchOutputBodySchema.shape,
  }),
]);

export type BrandDiscoveryOutput = z.infer<typeof brandDiscoveryOutputSchema>;
export type ScoredBrand = z.infer<typeof scoredBrandSchema>;
export type BrandResearchBrandOutput = Extract<
  BrandDiscoveryOutput,
  { operation: 'RESEARCH_BRAND' }
>;
