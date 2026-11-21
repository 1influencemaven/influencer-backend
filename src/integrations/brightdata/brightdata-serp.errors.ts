import type { BrightDataSearchResultCategory } from './search.types';

export type BrightDataSerpErrorCategory =
  | BrightDataSearchResultCategory
  | 'config_error';

/**
 * Surfaced by Brand Discovery WebSearch when Bright Data SERP fails.
 * Contact Discovery keeps using SearchResult.meta and does not throw this.
 */
export class BrightDataSerpProviderError extends Error {
  readonly code = 'BRIGHTDATA_SERP_PROVIDER_ERROR' as const;

  constructor(
    message: string,
    readonly details: {
      resultCategory: BrightDataSerpErrorCategory;
      httpStatus: number;
      zone?: string;
      parseError?: string;
    },
  ) {
    super(message);
    this.name = 'BrightDataSerpProviderError';
  }
}
