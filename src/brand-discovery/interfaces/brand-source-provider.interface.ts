export type IbpCriteriaSnapshot = {
  targetSectors: string[];
  excludedSectors: string[];
  brandSize: string[];
  markets: string[];
  collaborationTypes: string[];
  summary: string;
  alertSignals: string[];
  desirableCriteria: string[];
};

export type BrandGroundingSource =
  | 'SEARCH_EVIDENCE'
  | 'SEED_EVIDENCE'
  | 'MODEL_PRIOR';

export type RawBrandCandidate = {
  name: string;
  website: string;
  domain: string;
  sector?: string;
  market?: string;
  brandSize?: string;
  score?: number;
  fitReason?: string;
  source: string;
  evidenceUrls: string[];
  /**
   * Nest-classified evidence state to persist (AI-004.5.5).
   * Mastra path sets VERIFIED | UNVERIFIED; Legacy omits → NOT_ASSESSED at persist.
   */
  evidenceStatus?: 'VERIFIED' | 'UNVERIFIED' | 'NOT_ASSESSED';
  /**
   * Nest-assigned grounding (AI-004.5.1.2). Not emitted by Mastra.
   * Persisted under BrandCandidate.metadata.
   */
  groundingSource?: BrandGroundingSource;
  /** Json blob for Prisma BrandCandidate.metadata (grounding + provenance). */
  metadata?: Record<string, unknown>;
};

/**
 * Audit payload stored on BrandDiscoveryRun.searchMetadata.
 * `queries` = strings actually sent to WebSearchProvider.
 * `strategy` stays "llm" even when fallbackUsed is true.
 * `engine` identifies Nest AiService path vs Mastra orchestrator (AI-004.4.6).
 */
/**
 * Per-query SERP diagnostics (AI-004.5.1.1). No HTML bodies or secrets.
 * `resultCategory` uses Brand Discovery names (`organic_results`, not `ok`).
 */
export type BrandDiscoverySerpQueryDiagnostic = {
  query: string;
  resultCategory:
    | 'organic_results'
    | 'organic_empty'
    | 'consent_page'
    | 'soft_block'
    | 'unknown_html'
    | 'empty_body'
    | 'parse_error'
    | 'http_error'
    | 'network_error';
  httpStatus: number;
  responseBytes: number;
  latencyMs: number;
  attempts: number;
  organicResultsCount: number;
  parseError?: string;
  zone?: string;
};

export type BrandSearchMetadata = {
  engine?: 'legacy' | 'mastra';
  strategy: 'llm' | 'templates';
  queries: string[];
  plannedQueriesCount: number;
  validatedQueriesCount: number;
  fallbackUsed: boolean;
  searchHitsCount: number;
  planExecutionId?: string | null;
  scoreExecutionId?: string | null;
  scoredBrandsCount?: number;
  /** @deprecated Prefer verifiedCount — kept for older readers (equals verified). */
  evidenceAcceptedCount?: number;
  /** @deprecated Prefer discardedByEvidenceCount — hard discards only. */
  evidenceRejectedCount?: number;
  evidenceRejectReasonCounts?: Record<string, number>;
  /** AI-004.5.3 evidence classifier */
  verifiedCount?: number;
  unverifiedCount?: number;
  discardedByEvidenceCount?: number;
  afterHardFiltersCount?: number;
  afterDedupeCount?: number;
  afterExcludeExistingCount?: number;
  persistedCount?: number;
  /** AI-004.5.1.1 — one entry per SERP query (order matches `queries`). */
  serpDiagnostics?: BrandDiscoverySerpQueryDiagnostic[];
};

export type BrandDiscoverResult = {
  candidates: RawBrandCandidate[];
  searchMetadata: BrandSearchMetadata | null;
};

export type BrandSourceContext = {
  influencerName: string;
  influencerNiche?: string | null;
  ibp: IbpCriteriaSnapshot;
  limit: number;
  promptInstructions?: string;
};

export interface BrandSourceProvider {
  readonly name: string;
  discover(context: BrandSourceContext): Promise<BrandDiscoverResult>;
}
