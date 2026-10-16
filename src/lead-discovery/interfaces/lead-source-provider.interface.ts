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

/** Lean 2A run summary — no emails, pageUrls, or evidence blobs (ADR-0018). */
export type BusinessContactDiscoverySummary = {
  pagesAttempted: number;
  pagesSucceeded: number;
  pagesFailed: number;
  emailsFound: number;
  contactsCreated: number;
  contactsUpdated: number;
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
  businessContactDiscovery?: BusinessContactDiscoverySummary;
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
