/**
 * BullMQ worker options for CONTACT_DISCOVERY (2C.4.5.1 → 2C.4.6.1).
 *
 * Values mirror code timeouts (kept as literals here to avoid pulling Prisma
 * into Nest metadata modules). If those source constants change, update this
 * budget and its tests.
 *
 * Sources (Nest wait ceilings / SERP wall — not Mastra internal Bright Data caps):
 * - CONTACT_EMAIL_MASTRA_TIMEOUT_MS = 300_000
 * - CONTACT_PEOPLE_MASTRA_TIMEOUT_MS = 300_000
 * - Agency Discovery: AGENCY_DISCOVERY_DEFAULT_MAX_SERP_QUERIES (4)
 *   × BRIGHTDATA_SEARCH_TIMEOUT_MS default (60_000) = 240_000
 * - AGENCY_CONTACT_EMAILS_TIMEOUT_MS (300_000)
 *   × AGENCY_CONTACT_EMAILS_MAX_AGENCIES_PER_RUN (5) = 1_500_000
 * - AGENCY_CONTACT_PEOPLE_TIMEOUT_MS (300_000)
 *   × AGENCY_CONTACT_PEOPLE_MAX_AGENCIES_PER_RUN (5) = 1_500_000
 * - Nest publish/persist headroom = 300_000
 *
 * Sequencing note (2C.4.6.1): after 2A, track 2C (discovery→emails→people)
 * starts in parallel with conditional 2B. Emails-pass and people-pass are
 * sequential inside 2C; each agency wait is sequential. The lock budget uses
 * the conservative sequential sum (includes 2B even when it overlaps 2C).
 */

/** 2A FIND_BRAND_EMAILS Nest wait ceiling. */
export const CONTACT_DISCOVERY_BUDGET_2A_MS = 300_000;

/** 2B FIND_BRAND_PEOPLE Nest wait ceiling. */
export const CONTACT_DISCOVERY_BUDGET_2B_MS = 300_000;

/** Agency Discovery worst SERP wall (4 queries × 60s Bright Data default). */
export const CONTACT_DISCOVERY_BUDGET_AGENCY_DISCOVERY_MS = 240_000;

/** 2C.4.5 FIND_AGENCY_EMAILS sequential waits (5 × 300s). */
export const CONTACT_DISCOVERY_BUDGET_AGENCY_EMAILS_MS = 1_500_000;

/** 2C.4.6 FIND_AGENCY_PEOPLE sequential waits (5 × 300s). */
export const CONTACT_DISCOVERY_BUDGET_AGENCY_PEOPLE_MS = 1_500_000;

/**
 * Nest publish/persist/logging headroom (not a product operation timeout).
 */
export const CONTACT_DISCOVERY_LOCK_HEADROOM_MS = 300_000;

/**
 * lockDuration for `@Processor(CONTACT_DISCOVERY)`.
 *
 * BullMQ 5.x LockManager renews locks automatically when lockRenewTime > 0
 * (defaults to lockDuration / 2). Raising lockDuration does not disable renewal;
 * it widens the grace window if a renewal is delayed or fails once.
 *
 * Total: 300+300+240+1500+1500+300 = 4140s.
 */
export const CONTACT_DISCOVERY_LOCK_DURATION_MS =
  CONTACT_DISCOVERY_BUDGET_2A_MS +
  CONTACT_DISCOVERY_BUDGET_2B_MS +
  CONTACT_DISCOVERY_BUDGET_AGENCY_DISCOVERY_MS +
  CONTACT_DISCOVERY_BUDGET_AGENCY_EMAILS_MS +
  CONTACT_DISCOVERY_BUDGET_AGENCY_PEOPLE_MS +
  CONTACT_DISCOVERY_LOCK_HEADROOM_MS;

export const CONTACT_DISCOVERY_LOCK_DURATION_BREAKDOWN_MS = {
  track2A: CONTACT_DISCOVERY_BUDGET_2A_MS,
  track2B: CONTACT_DISCOVERY_BUDGET_2B_MS,
  agencyDiscoverySerpWorst: CONTACT_DISCOVERY_BUDGET_AGENCY_DISCOVERY_MS,
  agencyEmailsPass: CONTACT_DISCOVERY_BUDGET_AGENCY_EMAILS_MS,
  agencyPeoplePass: CONTACT_DISCOVERY_BUDGET_AGENCY_PEOPLE_MS,
  headroom: CONTACT_DISCOVERY_LOCK_HEADROOM_MS,
  total: CONTACT_DISCOVERY_LOCK_DURATION_MS,
} as const;
