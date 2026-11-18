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
  /**
   * RF-02: optional on-domain URLs to prefer in deterministic seed
   * (e.g. Brand Discovery evidenceUrls). Off-domain entries are ignored by seed.
   */
  seedUrls: z.array(z.string().url()).max(12).optional(),
});

/**
 * RF-04.3: selective HTML snapshots from Track 2A for same-run PEE reuse in 2B.
 * Additive / optional — historical payloads omit this field.
 */
export const contactResearchPageSnapshotSchema = z.object({
  url: z.string().min(1),
  /** RF-04.2 normalizeUrlKey of url (match key for PEE candidates). */
  normalizedUrl: z.string().min(1),
  /** ISO-8601 timestamp of the successful Unlocker download (not serialization time). */
  fetchedAt: z.string().min(1),
  /** Truncated HTML content usable by extractEmailsFromHtml. */
  content: z.string().min(1).max(20_000),
  contentType: z.string().optional(),
  truncated: z.boolean(),
  /** mailto: addresses preserved even when content truncates the href. */
  mailtoEmails: z.array(z.string().email()).max(50).optional(),
});

export type ContactResearchPageSnapshot = z.infer<
  typeof contactResearchPageSnapshotSchema
>;

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
  /**
   * RF-04.3: optional same-run snapshots from FIND_BRAND_EMAILS (Nest bridge).
   * Never persisted; omitted → Unlocker path unchanged.
   */
  pageSnapshots: z.array(contactResearchPageSnapshotSchema).max(4).optional(),
});

/**
 * 2C.4.1 — Agency Contact Research (emails pass).
 * Subject is Agency identity (never BrandCandidate / BBC).
 * Nest publishes under existing CONTACT_RESEARCH envelope; Mastra runner in later phase.
 */
export const contactResearchFindAgencyEmailsInputSchema = z.object({
  operation: z.literal('FIND_AGENCY_EMAILS'),
  /** Prisma Agency.id */
  agencyId: z.string().min(1),
  agencyName: z.string().min(1),
  website: z.string().min(1),
  /** Normalized agency host (lowercase, no www) — domain gate anchor. */
  domain: z.string().min(1),
  /** Optional influencer commercial context (query grounding only). */
  niche: z.string().nullable().optional(),
  niches: z.array(z.string().min(1)).max(20).optional(),
  country: z.string().nullable().optional(),
  markets: z.array(z.string().min(1)).max(20).optional(),
  maxSerpQueries: z.number().int().positive().max(10).default(5),
  maxPages: z.number().int().positive().max(12).default(5),
  /**
   * Optional on-domain seeds (Agency.website paths / InfluencerAgency.evidenceUrls).
   * Off-domain entries are ignored by the seed layer (Nest/Mastra).
   */
  seedUrls: z.array(z.string().url()).max(12).optional(),
});

/**
 * 2C.4.1 — Agency Contact Research (people pass).
 *
 * People-pass policy: ALWAYS (product decision). Nest must invoke this for every
 * eligible agency (RELEVANT | UNDER_REVIEW) regardless of FIND_AGENCY_EMAILS
 * outcome (empty, GENERAL-only, or HIGH/MEDIUM). This schema does not encode
 * an RF-03-style coverage gate.
 *
 * Runner/persist: 2C.4.6+. Snapshots from FIND_AGENCY_EMAILS are optional reuse.
 */
export const contactResearchFindAgencyPeopleInputSchema = z.object({
  operation: z.literal('FIND_AGENCY_PEOPLE'),
  agencyId: z.string().min(1),
  agencyName: z.string().min(1),
  website: z.string().min(1),
  domain: z.string().min(1),
  niche: z.string().nullable().optional(),
  niches: z.array(z.string().min(1)).max(20).optional(),
  country: z.string().nullable().optional(),
  markets: z.array(z.string().min(1)).max(20).optional(),
  /**
   * Agency-oriented commercial roles (defaults documented in
   * AGENCY_CONTACT_DEFAULT_PRIORITY_ROLES). Not a coverage gate.
   */
  priorityRoles: z.array(z.string().min(1)).max(12).optional(),
  /**
   * Explicit people-pass policy. Only ALWAYS is accepted — documents the
   * approved product rule in the contract surface.
   */
  peoplePassPolicy: z.literal('ALWAYS').default('ALWAYS'),
  maxSerpQueries: z.number().int().positive().max(12).default(4),
  maxProfilesToScrape: z.number().int().positive().max(15).default(5),
  /** Agency-site Unlocker pages for PEE after LinkedIn. */
  maxAgencyPages: z.number().int().positive().max(12).default(6),
  ocrEnabled: z.boolean().default(false),
  /**
   * Optional same-run snapshots from FIND_AGENCY_EMAILS (Nest bridge).
   * Omitted when emails pass found nothing or failed — people pass still runs.
   */
  pageSnapshots: z.array(contactResearchPageSnapshotSchema).max(4).optional(),
});

export const contactResearchInputSchema = z.discriminatedUnion('operation', [
  contactResearchDecideStepInputSchema,
  contactResearchFindBrandEmailsInputSchema,
  contactResearchFindBrandPeopleInputSchema,
  contactResearchFindAgencyEmailsInputSchema,
  contactResearchFindAgencyPeopleInputSchema,
]);

export type ContactResearchInput = z.infer<typeof contactResearchInputSchema>;

/** Default priority roles for FIND_AGENCY_PEOPLE (Nest may pass explicitly). */
export const AGENCY_CONTACT_DEFAULT_PRIORITY_ROLES = [
  'Partnerships',
  'Influencer Marketing',
  'Creator Relations',
  'Talent Partnerships',
  'Campaign Management',
] as const;

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
  /**
   * RF-04.3: capped successful page HTML for same-run 2B PEE reuse.
   * Emitted even when RF-03 later skips 2B. Optional for historical results.
   */
  pageSnapshots: z.array(contactResearchPageSnapshotSchema).max(4).optional(),
  trace: z
    .object({
      queries: z.array(z.string()),
      pages: z.array(z.string()),
      serpCalls: z.number().int().nonnegative(),
      pageCalls: z.number().int().nonnegative(),
      /** RF-04.2: additive page origin / reuse counters (omit on historical). */
      pageOriginCounts: z
        .object({
          seedPagesAttempted: z.number().int().nonnegative(),
          seedPagesDownloaded: z.number().int().nonnegative(),
          serpSeedPagesAttempted: z.number().int().nonnegative(),
          serpSeedPagesDownloaded: z.number().int().nonnegative(),
          llmPagesAttempted: z.number().int().nonnegative(),
          llmPagesDownloaded: z.number().int().nonnegative(),
          llmPagesReused: z.number().int().nonnegative(),
          duplicateUrlSkips: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .optional(),
});

/** RF-04.3: additive PEE snapshot reuse counters (omit on historical). */
export const contactResearchPeeReuseTraceSchema = z.object({
  snapshotsReceivedFrom2A: z.number().int().nonnegative(),
  peePagesReused: z.number().int().nonnegative(),
  peePagesFetchedUnlocker: z.number().int().nonnegative(),
  peePagesRejected: z.number().int().nonnegative(),
  unlockerCallsAvoided: z.number().int().nonnegative(),
});

export type ContactResearchPeeReuseTrace = z.infer<
  typeof contactResearchPeeReuseTraceSchema
>;

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
      /** RF-04.3: same-run PEE snapshot reuse (omit when unused / historical). */
      peeReuse: contactResearchPeeReuseTraceSchema.optional(),
    })
    .optional(),
});

/** Shared outcome enum for agency contact research passes. */
export const agencyContactResearchOutcomeSchema = z.enum([
  'RESULTS_FOUND',
  'NO_MATCHES',
  'PROVIDER_FAILURE',
]);

export type AgencyContactResearchOutcome = z.infer<
  typeof agencyContactResearchOutcomeSchema
>;

/**
 * Commercial priority aligned with Prisma CommercialRelevance (no SMTP verify).
 * HIGH = partnerships/creators; NEUTRAL = marketing/press; UNKNOWN = general;
 * LOW = support / non-outreach.
 */
export const agencyContactCommercialRelevanceSchema = z.enum([
  'HIGH',
  'NEUTRAL',
  'LOW',
  'UNKNOWN',
]);

/**
 * RF-01-style provenance for agency mailboxes.
 * verificationStatus is UNVERIFIED only — VERIFIED is not representable here
 * (no fake SMTP).
 */
export const agencyContactEmailProvenanceSchema = z.object({
  discoveryStatus: z.literal('FOUND').default('FOUND'),
  attributionStatus: z
    .enum(['ATTRIBUTED', 'UNATTRIBUTED'])
    .default('ATTRIBUTED'),
  verificationStatus: z.literal('UNVERIFIED').default('UNVERIFIED'),
});

/**
 * One agency mailbox / email hit from FIND_AGENCY_EMAILS.
 * Classification fields are optional on Mastra emit; Nest may fill/overwrite
 * after domain gates (never invent VERIFIED).
 *
 * `sourceKind` is always `agency_web` for this operation (literal page extract).
 * Same token as people-pass agency_web; mailbox hits never carry linkedin/ocr.
 * ATTRIBUTED in provenance means domain/mailbox attribution to the Agency,
 * not person attribution (persons are FIND_AGENCY_PEOPLE only).
 */
export const agencyContactFoundEmailSchema = z.object({
  email: z.string().email(),
  sourceUrl: z.string().url(),
  evidenceSnippet: z.string().max(500).optional(),
  /**
   * Evidence channel for Nest persist (`AgencyContact.metadata.sourceKind`).
   * Fixed to agency_web — Mastra emits; Nest must not invent a different kind.
   */
  sourceKind: z.literal('agency_web').default('agency_web'),
  /** Shared / role inbox vs person-looking local-part (Nest authoritative). */
  isGeneric: z.boolean().optional(),
  commercialRelevance: agencyContactCommercialRelevanceSchema.optional(),
  /** Free-text outreach role label (Partnerships, Creator Relations, …). */
  outreachRole: z.string().min(1).max(120).optional(),
  provenance: agencyContactEmailProvenanceSchema.optional(),
});

export type AgencyContactFoundEmail = z.infer<
  typeof agencyContactFoundEmailSchema
>;

/** Source of a person-linked agency email (people pass). */
export const agencyContactEmailSourceKindSchema = z.enum([
  'linkedin',
  'agency_web',
  'ocr',
]);

export type AgencyContactEmailSourceKind = z.infer<
  typeof agencyContactEmailSourceKindSchema
>;

export const agencyContactPersonEmailSchema = z.object({
  email: z.string().email(),
  sourceUrl: z.string().url(),
  sourceKind: agencyContactEmailSourceKindSchema,
  evidenceSnippet: z.string().max(500).optional(),
  provenance: agencyContactEmailProvenanceSchema.optional(),
});

export type AgencyContactPersonEmail = z.infer<
  typeof agencyContactPersonEmailSchema
>;

export const agencyContactPersonSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  linkedinUrl: z.string().url(),
  emails: z.array(agencyContactPersonEmailSchema).default([]),
});

export type AgencyContactPerson = z.infer<typeof agencyContactPersonSchema>;

/** PEE reuse counters for agency emails→people bridge (naming avoids brand "2A"). */
export const agencyContactPeeReuseTraceSchema = z.object({
  snapshotsReceivedFromEmailsPass: z.number().int().nonnegative(),
  peePagesReused: z.number().int().nonnegative(),
  peePagesFetchedUnlocker: z.number().int().nonnegative(),
  peePagesRejected: z.number().int().nonnegative(),
  unlockerCallsAvoided: z.number().int().nonnegative(),
});

export type AgencyContactPeeReuseTrace = z.infer<
  typeof agencyContactPeeReuseTraceSchema
>;

export const contactResearchFindAgencyEmailsOutputSchema = z.object({
  operation: z.literal('FIND_AGENCY_EMAILS'),
  outcome: agencyContactResearchOutcomeSchema,
  emails: z.array(agencyContactFoundEmailSchema),
  summary: z.string().optional(),
  pageSnapshots: z.array(contactResearchPageSnapshotSchema).max(4).optional(),
  trace: z
    .object({
      queries: z.array(z.string()),
      pages: z.array(z.string()),
      serpCalls: z.number().int().nonnegative(),
      pageCalls: z.number().int().nonnegative(),
      pageOriginCounts: z
        .object({
          seedPagesAttempted: z.number().int().nonnegative(),
          seedPagesDownloaded: z.number().int().nonnegative(),
          serpSeedPagesAttempted: z.number().int().nonnegative(),
          serpSeedPagesDownloaded: z.number().int().nonnegative(),
          llmPagesAttempted: z.number().int().nonnegative(),
          llmPagesDownloaded: z.number().int().nonnegative(),
          llmPagesReused: z.number().int().nonnegative(),
          duplicateUrlSkips: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .optional(),
});

export const contactResearchFindAgencyPeopleOutputSchema = z.object({
  operation: z.literal('FIND_AGENCY_PEOPLE'),
  outcome: agencyContactResearchOutcomeSchema,
  people: z.array(agencyContactPersonSchema),
  summary: z.string().optional(),
  trace: z
    .object({
      queries: z.array(z.string()),
      linkedinUrlsConsidered: z.array(z.string()),
      profilesScraped: z.number().int().nonnegative(),
      serpCalls: z.number().int().nonnegative(),
      agencyPagesFetched: z.number().int().nonnegative(),
      ocrAttempts: z.number().int().nonnegative().optional(),
      peeReuse: agencyContactPeeReuseTraceSchema.optional(),
    })
    .optional(),
});

export const contactResearchOutputSchema = z.discriminatedUnion('operation', [
  contactResearchDecideStepOutputSchema,
  contactResearchFindBrandEmailsOutputSchema,
  contactResearchFindBrandPeopleOutputSchema,
  contactResearchFindAgencyEmailsOutputSchema,
  contactResearchFindAgencyPeopleOutputSchema,
]);

export type ContactResearchOutput = z.infer<typeof contactResearchOutputSchema>;
