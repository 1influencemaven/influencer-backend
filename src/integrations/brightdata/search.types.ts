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

/** Runtime search is Bright Data only. `tavily` retained for historical rows. */
export type SearchProviderId = 'brightdata' | 'tavily';

/**
 * Final-attempt classification for one Bright Data Search call.
 * No response bodies — only status / size / category.
 *
 * AI-004.5.1.1:
 * - `ok` = organic results extracted (Brand Discovery telemetry may label as organic_results)
 * - `organic_empty` = HTML looks like a SERP page but 0 organics (not a catch-all)
 * - `consent_page` / `soft_block` / `unknown_html` = anomalous HTML with 0 organics
 * Legacy Lead Discovery still treats only classic hard failures as SearchFailure.
 */
export type BrightDataSearchResultCategory =
  | 'ok'
  | 'empty_body'
  | 'parse_error'
  | 'organic_empty'
  | 'consent_page'
  | 'soft_block'
  | 'unknown_html'
  | 'network_error'
  | 'http_error';

/** Brand Discovery / docs alias: successful organic extraction. */
export type BrandDiscoverySerpResultCategory =
  | 'organic_results'
  | Exclude<BrightDataSearchResultCategory, 'ok'>;

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
  resultCategory?: BrightDataSearchResultCategory;
  /** Organic items extracted on the final attempt (AI-004.5.1.1). */
  organicResultsCount?: number;
};

export type SearchResult = {
  items: SearchResultItem[];
  meta: SearchExecutionMetadata;
};
