/** Shared Search types live in integrations/brightdata (Brand + Lead Discovery). */
export type {
  BrightDataSearchResultCategory,
  SearchExecutionMetadata,
  SearchProviderId,
  SearchQuery,
  SearchResult,
  SearchResultItem,
} from '../../integrations/brightdata/search.types';

import type { SearchProviderId } from '../../integrations/brightdata/search.types';

export type LinkedInCandidate = {
  url: string;
  score: number;
  reasons: string[];
  searchPosition: number;
  query: string;
  provider: SearchProviderId;
  title?: string;
  snippet?: string;
};

export type SearchFailureCode =
  | 'EMPTY_BODY'
  | 'PARSE_ERROR'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR';

export type SearchFailure = {
  code: SearchFailureCode;
  message: string;
  retryable: boolean;
  query: string;
  httpStatus?: number;
};

/** Aggregated Bright Data Search diagnostics (no bodies / secrets). */
export type BrightDataSearchDiagnostics = {
  requests: number;
  hits: number;
  emptyBody: number;
  parseError: number;
  organicEmpty: number;
  networkError: number;
  httpError: number;
  /** Top status codes seen, e.g. { "200": 18, "401": 2 }. */
  httpStatusCounts: Record<string, number>;
};

/**
 * @deprecated Tavily fallback removed. Optional on traces for older fixtures only.
 */
export type TavilySearchDiagnostics = {
  requests: number;
  hits: number;
  httpOkWithResults: number;
  httpOkEmptyResults: number;
  httpError: number;
  networkError: number;
  timeout: number;
};

export type LeadSearchRunTrace = {
  searchRunId: string;
  brightDataRequests: number;
  /** BD search attempts that returned empty body / network failure / HTTP 0. */
  brightDataSearchFailures: number;
  /** Always 0 on new runs (Tavily removed). Historical runs may have been > 0. */
  tavilyRequests: number;
  /** Always false on new runs — no external search fallback. */
  fallbackActivated: boolean;
  queriesExecuted: number;
  /** Pre-dedupe count of LinkedIn `/in/` URL-validated (and scored) candidates. */
  linkedinUrlValidated: number;
  /** Post-dedupe scored candidates (legacy alias: linkedinCandidatesFound). */
  linkedinCandidatesFound: number;
  /** Post SCORE_THRESHOLD. */
  qualifiedCandidates: number;
  selectedUrls: string[];
  failures: SearchFailure[];
  brightDataDiagnostics: BrightDataSearchDiagnostics;
  /** Absent on new runs. */
  tavilyDiagnostics?: TavilySearchDiagnostics;
};

export type LeadSearchDiscoveryResult = {
  profileUrls: string[];
  trace: LeadSearchRunTrace;
  /** Full ladder before early-stop. */
  plannedQueries: string[];
  /** Query strings actually sent to BD and/or Tavily (in execution order). */
  executedQueries: string[];
  /**
   * Sum of search-result items returned by providers during this run
   * (Bright Data items + Tavily items). Not leads / profiles / emails.
   */
  searchHitsCount: number;
};
