import { z } from 'zod';

/**
 * Track 2C — Agency Discovery contracts.
 * 2C.1: domain foundation. 2C.2: DISCOVER_AGENCIES classify/persist engine shapes.
 * 2C.3: wired into ContactEmailMastraOrchestrator (always-on, soft-isolated).
 *
 * Nest owns SERP + persistence. Classification may run in Nest (heuristics) or
 * via influencer-ai `runDiscoverAgencies` (same contracts).
 */

/** Agency taxonomy — classification must be evidence-backed. */
export const agencyTypeSchema = z.enum([
  'INFLUENCER_MARKETING_AGENCY',
  'TALENT_REPRESENTATION',
  'MARKETPLACE',
  'GENERAL_MARKETING',
  'DIRECTORY',
  'OTHER',
]);

export type AgencyType = z.infer<typeof agencyTypeSchema>;

/**
 * Relevance of an agency to a specific influencer (association-level).
 * Orthogonal to AgencyType (identity-level).
 */
export const agencyRelevanceStatusSchema = z.enum([
  'UNDER_REVIEW',
  'RELEVANT',
  'NOT_RELEVANT',
  'DISCARDED',
]);

export type AgencyRelevanceStatus = z.infer<typeof agencyRelevanceStatusSchema>;

export const agencyEvidenceSourceKindSchema = z.enum([
  'serp',
  'website',
  'directory',
  'other',
]);

export type AgencyEvidenceSourceKind = z.infer<
  typeof agencyEvidenceSourceKindSchema
>;

/** Traceable evidence for agency↔influencer discovery (additive fields optional). */
export const agencyEvidenceRefSchema = z.object({
  url: z.string().url(),
  excerpt: z.string().max(500).optional(),
  /** Optional classifier note; not free-form opportunity prose. */
  note: z.string().max(300).optional(),
  sourceKind: agencyEvidenceSourceKindSchema.optional(),
  /** ISO-8601 when the evidence was obtained (Nest/SERP time). */
  fetchedAt: z.string().optional(),
});

export type AgencyEvidenceRef = z.infer<typeof agencyEvidenceRefSchema>;

/**
 * Identity snapshot of an agency (maps to Prisma Agency, without DB ids).
 * `domain` must be normalized host (lowercase, no www) before persist.
 */
export const agencyIdentitySchema = z.object({
  name: z.string().min(1).max(300),
  website: z.string().url().optional(),
  domain: z.string().min(1).max(253),
  country: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  agencyType: agencyTypeSchema.default('OTHER'),
});

export type AgencyIdentity = z.infer<typeof agencyIdentitySchema>;

/**
 * Per-influencer discovery association (maps to InfluencerAgency fields).
 * Evidence and relevance belong here — not on global Agency identity.
 */
export const influencerAgencyDiscoverySchema = z.object({
  relevanceStatus: agencyRelevanceStatusSchema.default('UNDER_REVIEW'),
  relevanceExplanation: z.string().max(2000).optional(),
  niches: z.array(z.string().min(1)).max(20).default([]),
  markets: z.array(z.string().min(1)).max(20).default([]),
  evidenceUrls: z.array(z.string().url()).max(20).default([]),
  evidence: z.array(agencyEvidenceRefSchema).max(20).optional(),
});

export type InfluencerAgencyDiscovery = z.infer<
  typeof influencerAgencyDiscoverySchema
>;

/** SERP organic hit passed from Nest → classifier (2C.2). */
export const agencySerpHitSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  content: z.string().optional(),
});

export type AgencySerpHit = z.infer<typeof agencySerpHitSchema>;

/** Additive search audit for a 2C discovery pass. */
export const agencySearchMetadataSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  queries: z.array(z.string()).max(20).optional(),
  serpCalls: z.number().int().nonnegative().optional(),
  searchHitsCount: z.number().int().nonnegative().optional(),
  dedupedHitsCount: z.number().int().nonnegative().optional(),
  classifiedCount: z.number().int().nonnegative().optional(),
  persistedCount: z.number().int().nonnegative().optional(),
  providerId: z.string().min(1).optional(),
  providerErrors: z.array(z.string().max(500)).max(20).optional(),
  notes: z.string().max(1000).optional(),
});

export type AgencySearchMetadata = z.infer<typeof agencySearchMetadataSchema>;

/**
 * Discovery input. Influencer commercial context drives queries.
 * brandCandidateId intentionally absent (agencies ≠ brands).
 *
 * When `searchHits` is provided, the runner classifies only (Nest already ran SERP).
 * When omitted, Nest engine builds queries + SERP before classify.
 */
export const agencyDiscoveryInputSchema = z.object({
  operation: z.literal('DISCOVER_AGENCIES'),
  /** Influencer id (UUID in production; min length for Nest resource ids). */
  influencerId: z.string().min(1),
  influencerName: z.string().min(1),
  niche: z.string().nullable().optional(),
  subNiche: z.string().nullable().optional(),
  niches: z.array(z.string()).optional(),
  country: z.string().nullable().optional(),
  markets: z.array(z.string()).optional(),
  /** Optional IBP snapshot fields used for query grounding. */
  ibpTargetSectors: z.array(z.string()).optional(),
  ibpMarkets: z.array(z.string()).optional(),
  maxSerpQueries: z.number().int().positive().max(10).default(4),
  maxResultsPerQuery: z.number().int().positive().max(10).default(6),
  /** Pre-fetched SERP organics (Nest → classifier). */
  searchHits: z.array(agencySerpHitSchema).max(60).optional(),
});

export type AgencyDiscoveryInput = z.infer<typeof agencyDiscoveryInputSchema>;

/** One discovered agency candidate in a discovery output. */
export const agencyDiscoveryCandidateSchema = z.object({
  agency: agencyIdentitySchema,
  association: influencerAgencyDiscoverySchema,
});

export type AgencyDiscoveryCandidate = z.infer<
  typeof agencyDiscoveryCandidateSchema
>;

export const agencyDiscoveryOutputSchema = z.object({
  operation: z.literal('DISCOVER_AGENCIES'),
  outcome: z.enum(['RESULTS_FOUND', 'NO_MATCHES', 'PROVIDER_FAILURE']),
  candidates: z.array(agencyDiscoveryCandidateSchema).max(50),
  summary: z.string().max(2000).optional(),
  searchMetadata: agencySearchMetadataSchema.optional(),
});

export type AgencyDiscoveryOutput = z.infer<typeof agencyDiscoveryOutputSchema>;
