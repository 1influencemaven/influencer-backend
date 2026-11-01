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
  resultCategory?: BrightDataSearchResultCategory;
};

export type SearchResult = {
  items: SearchResultItem[];
  meta: SearchExecutionMetadata;
};
