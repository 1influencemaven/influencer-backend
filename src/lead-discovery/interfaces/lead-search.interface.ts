export type SearchQuery = {
  text: string;
  geo?: { hl?: string; gl?: string };
  num?: number;
};

export type SearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  position: number;
  domain: string;
};

export type SearchProviderId = 'brightdata' | 'tavily';

/**
 * Final-attempt classification for one Bright Data Search call.
 * No response bodies — only status / size / category.
 */
export type BrightDataSearchResultCategory =
  | 'ok'
  | 'empty_body'
  | 'parse_error'
  | 'organic_empty'
  | 'network_error'
  | 'http_error';

export type SearchExecutionMetadata = {
  provider: SearchProviderId;
  zone?: string;
  attempt: number;
  httpStatus: number;
  responseBytes: number;
  elapsedMs: number;
  emptyBody: boolean;
  parseError?: string;
  query: string;
  /** Aggregatable outcome of this attempt (diagnostics). */
  resultCategory?: BrightDataSearchResultCategory;
};

export type SearchResult = {
  items: SearchResultItem[];
  meta: SearchExecutionMetadata;
};

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

/** Aggregated Tavily fallback diagnostics (no keys / snippets / bodies). */
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
  tavilyRequests: number;
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
  tavilyDiagnostics: TavilySearchDiagnostics;
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
