export type WebSearchHit = {
  title: string;
  url: string;
  content: string;
};

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, options?: { maxResults?: number }): Promise<WebSearchHit[]>;
}

export const WEB_SEARCH_PROVIDER_TOKEN = Symbol('WEB_SEARCH_PROVIDER');
