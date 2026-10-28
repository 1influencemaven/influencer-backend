import type { BusinessContactPageResult } from '../utils/unlocker-fetch.util';

/**
 * Audit payload stored on LeadDiscoveryRun.searchMetadata (ADR-0017).
 *
 * Distinguishes AI planning (roles/scrapers) from deterministic query generation
 * (PersonQueryLadderBuilder). Does NOT duplicate Leads / ContactChannels.
 *
 * searchHitsCount = total search-result items returned by search providers
 * during the run (e.g. Bright Data 20 + Tavily 8 = 28). NOT leads, unique
 * profiles, selected URLs, emails, or ContactChannels.
 *
 * strategy = "manual" means the caller selected Bright Data scraper optionIds
 * and bypassed AI planning — NOT that a human manually entered a contact.
 */
export type LeadDiscoveryTrack = '2A' | '2B' | '2C';

export type LeadSearchStrategy = 'llm' | 'manual' | 'unknown';

/**
 * Result quality for a COMPLETED run (status stays COMPLETED|FAILED).
 * - FULL: results persisted and no critical provider failure.
 * - EMPTY_LEGITIMATE: providers completed without critical failure; zero valid results.
 * - PROVIDER_FAILURE: a provider failure blocked part or all of the flow.
 *
 * Absent on historical runs → treat as unknown (do not assume FULL).
 */
export type LeadDiscoveryOutcome =
  | 'FULL'
  | 'EMPTY_LEGITIMATE'
  | 'PROVIDER_FAILURE';

export type LeadDiscoveryWarningCode =
  | 'unlocker_all_pages_failed'
  | 'people_scraper_all_failed'
  | 'people_search_provider_failed'
  | 'mixed_provider_failure';

/**
 * Lean 2A run summary (ADR-0018 + observability).
 * Never includes discovered emails or evidence snippets.
 * Optional `pageResults` are diagnostic (URL + Unlocker API outcome only).
 */
export type BusinessContactDiscoverySummary = {
  pagesAttempted: number;
  pagesSucceeded: number;
  pagesFailed: number;
  emailsFound: number;
  contactsCreated: number;
  contactsUpdated: number;
  /** Unlocker zone name used for 2A fetches (never credentials). */
  unlockerZone?: string;
  /** Failure tallies by outcome (excludes `ok`). */
  failureCountsByCategory?: Record<string, number>;
  /** Per-page Unlocker diagnostics — no HTML bodies or emails. */
  pageResults?: BusinessContactPageResult[];
};

/**
 * 2B people-search audit. Present only on instrumented runs.
 * All counters are known numbers — `0` means zero, not "unknown".
 * Absence of this object (legacy) means counters are unknown.
 */
export type PeopleSearchBrightDataDiagnostics = {
  requests: number;
  hits: number;
  emptyBody: number;
  parseError: number;
  organicEmpty: number;
  networkError: number;
  httpError: number;
  httpStatusCounts: Record<string, number>;
};

export type PeopleSearchTavilyDiagnostics = {
  requests: number;
  hits: number;
  httpOkWithResults: number;
  httpOkEmptyResults: number;
  httpError: number;
  networkError: number;
  timeout: number;
};

export type PeopleSearchTrace = {
  searchHitsReceived: number;
  /** Search hits that passed LinkedIn `/in/` URL normalization (pre-dedupe). */
  linkedinUrlValidated: number;
  /** URL-validated candidates after scoring (same population as validated). */
  scoredCandidates: number;
  /** After SCORE_THRESHOLD filter (post-dedupe). */
  qualifiedCandidates: number;
  selectedProfileUrlsCount: number;
  /** Cap 50 — LinkedIn profile URLs only (no emails). */
  selectedProfileUrls: string[];
  brightDataSearchRequests: number;
  brightDataSearchFailures: number;
  tavilyFallbackRequests: number;
  scraperInvocations: number;
  scraperSuccesses: number;
  scraperFailures: number;
  /** Sanitized search failure codes (e.g. EMPTY_BODY, NETWORK_ERROR). */
  searchFailureCodes: string[];
  /** Sanitized scraper error names (no stack traces / secrets). */
  scraperErrorCodes: string[];
  /** Additive BD Search tallies (absent on older runs). */
  brightDataDiagnostics?: PeopleSearchBrightDataDiagnostics;
  /** Additive Tavily tallies (absent on older runs / when fallback off). */
  tavilyDiagnostics?: PeopleSearchTavilyDiagnostics;
};

export type LeadSearchMetadata = {
  strategy: LeadSearchStrategy;
  /** Tracks that actually ran. */
  tracks: LeadDiscoveryTrack[];
  priorityRoles: string[];
  scraperIds: string[];
  /** Full PersonQueryLadder size before early-stop. */
  plannedQueriesCount: number;
  /** Queries actually sent to search providers (= queries.length). */
  validatedQueriesCount: number;
  /** Query strings sent (BD then Tavily ops; duplicates allowed if both ran). */
  queries: string[];
  fallbackUsed: boolean;
  /**
   * When fallbackUsed: ai_plan_failed | search_tavily |
   * ai_plan_failed_and_search_tavily. Otherwise null.
   */
  fallbackReason: string | null;
  searchHitsCount: number;
  /**
   * COMPLETED-run quality. Set by LeadDiscoveryService after persistence.
   * Absent on historical runs → unknown.
   */
  outcome?: LeadDiscoveryOutcome;
  warningCode?: LeadDiscoveryWarningCode | null;
  warningMessage?: string | null;
  /** Person Leads persisted for this run (orthogonal to BrandBusinessContact). */
  personLeadsCreated?: number;
  /** BrandBusinessContact upserts created in this run. */
  businessContactsCreated?: number;
  businessContactDiscovery?: BusinessContactDiscoverySummary;
  peopleSearchTrace?: PeopleSearchTrace;
};

export type LeadFindResult = {
  contacts: RawLeadContact[];
  searchMetadata: LeadSearchMetadata | null;
};

export type LeadSourceOption = {
  id: string;
  name: string;
  kind?: string;
};

export type LeadSourceOptionsResponse = {
  providerId: string;
  options: LeadSourceOption[];
};

export type RawLeadContact = {
  contactName: string;
  title?: string;
  email?: string;
  profileUrl?: string;
  companyName?: string;
  companyLinkedInUrl?: string;
  companyWebsite?: string;
  fitReason?: string;
  sourceOptionId?: string;
  source: string;
  metadata?: Record<string, unknown>;
};

export type LeadFindContext = {
  brandName: string;
  website: string;
  domain: string;
  limit: number;
  optionIds: string[];
  promptInstructions?: string;
};

export interface LeadSourceProvider {
  readonly id: string;
  isConfigured(): boolean;
  listOptions(): Promise<LeadSourceOption[]>;
  findContacts(context: LeadFindContext): Promise<LeadFindResult>;
}

export const LEAD_SOURCE_PROVIDER_TOKEN = Symbol('LEAD_SOURCE_PROVIDER');

export function resolveLeadFallbackReason(
  aiPlanFailed: boolean,
  searchTavily: boolean,
): string | null {
  if (aiPlanFailed && searchTavily) {
    return 'ai_plan_failed_and_search_tavily';
  }
  if (aiPlanFailed) {
    return 'ai_plan_failed';
  }
  if (searchTavily) {
    return 'search_tavily';
  }
  return null;
}
