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
};

/**
 * Audit payload stored on BrandDiscoveryRun.searchMetadata.
 * `queries` = strings actually sent to WebSearchProvider.
 * `strategy` stays "llm" even when fallbackUsed is true.
 */
export type BrandSearchMetadata = {
  strategy: 'llm' | 'templates';
  queries: string[];
  plannedQueriesCount: number;
  validatedQueriesCount: number;
  fallbackUsed: boolean;
  searchHitsCount: number;
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
