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

export type BrandSourceContext = {
  influencerName: string;
  influencerNiche?: string | null;
  ibp: IbpCriteriaSnapshot;
  limit: number;
  promptInstructions?: string;
};

export interface BrandSourceProvider {
  readonly name: string;
  discover(context: BrandSourceContext): Promise<RawBrandCandidate[]>;
}

export const BRAND_SOURCE_PROVIDER_TOKEN = Symbol('BRAND_SOURCE_PROVIDER');
