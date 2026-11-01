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

export const contactResearchInputSchema = z.object({
  operation: z.literal('DECIDE_STEP'),
  state: contactResearchStateSnapshotSchema,
});

export type ContactResearchInput = z.infer<typeof contactResearchInputSchema>;

export const contactResearchActionSchema = z.enum([
  'search_web',
  'fetch_page',
  'extract_emails',
  'finalize_research',
]);

export const contactResearchOutputSchema = z.object({
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

export type ContactResearchOutput = z.infer<typeof contactResearchOutputSchema>;
