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
  | 'RATE_LIMITED';

export type SearchFailure = {
  code: SearchFailureCode;
  message: string;
  retryable: boolean;
  query: string;
  httpStatus?: number;
};

export type LeadSearchRunTrace = {
  searchRunId: string;
  brightDataRequests: number;
  tavilyRequests: number;
  fallbackActivated: boolean;
  queriesExecuted: number;
  linkedinCandidatesFound: number;
  selectedUrls: string[];
  failures: SearchFailure[];
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
