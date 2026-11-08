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

export const contactResearchInputSchema = z.discriminatedUnion('operation', [
  contactResearchDecideStepInputSchema,
  contactResearchFindBrandEmailsInputSchema,
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

export const contactResearchOutputSchema = z.discriminatedUnion('operation', [
  contactResearchDecideStepOutputSchema,
  contactResearchFindBrandEmailsOutputSchema,
]);

export type ContactResearchOutput = z.infer<typeof contactResearchOutputSchema>;
