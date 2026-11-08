import { z } from 'zod';

export const contactResearchStateSnapshotSchema = z.object({
  brandName: z.string().min(1),
  website: z.string().min(1),
  domain: z.string().min(1),
  marketHint: z.string().optional(),
  limits: z.object({
    maxSerpQueries: z.number().int().positive(),
    maxPages: z.number().int().positive(),
  }),
  serpQueriesUsed: z.number().int().nonnegative(),
  pagesFetched: z.number().int().nonnegative(),
  iterationsRemaining: z.number().int().nonnegative(),
  emailsFound: z.array(z.string()),
  executedQueries: z.array(z.string()),
  fetchedUrls: z.array(z.string()),
  lastObservation: z.string().optional(),
});

export type ContactResearchStateSnapshot = z.infer<
  typeof contactResearchStateSnapshotSchema
>;

export const contactResearchActionSchema = z.enum([
  'search_web',
  'fetch_page',
  'extract_emails',
  'finalize_research',
]);

/** Legacy Nest-orchestrated step decision (ADR-0021). */
const contactResearchDecideStepInputSchema = z.object({
  operation: z.literal('DECIDE_STEP'),
  state: contactResearchStateSnapshotSchema,
});

/**
 * Tool-loop research (Paso 2+): Mastra agent uses Bright Data tools
 * and returns brand emails in one execution (client prompt 2A scope).
 */
const contactResearchFindBrandEmailsInputSchema = z.object({
  operation: z.literal('FIND_BRAND_EMAILS'),
  brandName: z.string().min(1),
  website: z.string().min(1),
  domain: z.string().min(1),
  niche: z.string().optional(),
  maxSerpQueries: z.number().int().positive().max(10).default(5),
  maxPages: z.number().int().positive().max(12).default(5),
});

/**
 * Track 2B: discover people (LinkedIn) for an approved brand, then attach
 * emails via LinkedIn text → brand-web PEE → OCR (sourceKind).
 */
const contactResearchFindBrandPeopleInputSchema = z.object({
  operation: z.literal('FIND_BRAND_PEOPLE'),
  brandName: z.string().min(1),
  website: z.string().min(1),
  domain: z.string().min(1),
  niche: z.string().optional(),
  priorityRoles: z.array(z.string().min(1)).max(12).optional(),
  maxSerpQueries: z.number().int().positive().max(12).default(4),
  maxProfilesToScrape: z.number().int().positive().max(15).default(5),
  /** Brand-site Unlocker pages for PEE after LinkedIn (Fase B). */
  maxBrandPages: z.number().int().positive().max(12).default(6),
  /** When true, runner may attempt vision OCR after A+B (Fase C). */
  ocrEnabled: z.boolean().default(false),
});

export const contactResearchInputSchema = z.discriminatedUnion('operation', [
  contactResearchDecideStepInputSchema,
  contactResearchFindBrandEmailsInputSchema,
  contactResearchFindBrandPeopleInputSchema,
]);

export type ContactResearchInput = z.infer<typeof contactResearchInputSchema>;

const contactResearchDecideStepOutputSchema = z.object({
  operation: z.literal('DECIDE_STEP'),
  action: contactResearchActionSchema,
  reason: z.string().min(1),
  query: z.string().optional(),
  url: z.string().optional(),
  finalize: z
    .object({
      outcome: z.enum(['RESULTS_FOUND', 'NO_MATCHES', 'PROVIDER_FAILURE']),
      summary: z.string().optional(),
    })
    .optional(),
});

export const contactResearchFoundEmailSchema = z.object({
  email: z.string().email(),
  sourceUrl: z.string().url(),
  evidenceSnippet: z.string().max(500).optional(),
});

/** Where a person-linked email was obtained (Track 2B cascade). */
export const contactResearchEmailSourceKindSchema = z.enum([
  'linkedin',
  'brand_web',
  'ocr',
]);

export type ContactResearchEmailSourceKind = z.infer<
  typeof contactResearchEmailSourceKindSchema
>;

export const contactResearchPersonEmailSchema = z.object({
  email: z.string().email(),
  sourceUrl: z.string().url(),
  sourceKind: contactResearchEmailSourceKindSchema,
  evidenceSnippet: z.string().max(500).optional(),
});

export type ContactResearchPersonEmail = z.infer<
  typeof contactResearchPersonEmailSchema
>;

export const contactResearchPersonSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  linkedinUrl: z.string().url(),
  emails: z.array(contactResearchPersonEmailSchema).default([]),
});

export type ContactResearchPerson = z.infer<typeof contactResearchPersonSchema>;

const contactResearchFindBrandEmailsOutputSchema = z.object({
  operation: z.literal('FIND_BRAND_EMAILS'),
  outcome: z.enum(['RESULTS_FOUND', 'NO_MATCHES', 'PROVIDER_FAILURE']),
  emails: z.array(contactResearchFoundEmailSchema),
  summary: z.string().optional(),
  trace: z
    .object({
      queries: z.array(z.string()),
      pages: z.array(z.string()),
      serpCalls: z.number().int().nonnegative(),
      pageCalls: z.number().int().nonnegative(),
    })
    .optional(),
});

const contactResearchFindBrandPeopleOutputSchema = z.object({
  operation: z.literal('FIND_BRAND_PEOPLE'),
  outcome: z.enum(['RESULTS_FOUND', 'NO_MATCHES', 'PROVIDER_FAILURE']),
  people: z.array(contactResearchPersonSchema),
  summary: z.string().optional(),
  trace: z
    .object({
      queries: z.array(z.string()),
      linkedinUrlsConsidered: z.array(z.string()),
      profilesScraped: z.number().int().nonnegative(),
      serpCalls: z.number().int().nonnegative(),
      brandPagesFetched: z.number().int().nonnegative(),
      ocrAttempts: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const contactResearchOutputSchema = z.discriminatedUnion('operation', [
  contactResearchDecideStepOutputSchema,
  contactResearchFindBrandEmailsOutputSchema,
  contactResearchFindBrandPeopleOutputSchema,
]);

export type ContactResearchOutput = z.infer<typeof contactResearchOutputSchema>;
