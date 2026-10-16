import { Injectable } from '@nestjs/common';

import { BrightDataSearchClient } from '../../lead-discovery/clients/brightdata-search.client';
import type {
  WebSearchHit,
  WebSearchProvider,
} from '../interfaces/web-search-provider.interface';

const DEFAULT_MAX_RESULTS = 6;

@Injectable()
export class BrightDataWebSearchProvider implements WebSearchProvider {
  readonly name = 'brightdata';

  constructor(private readonly client: BrightDataSearchClient) {}

  async search(
    query: string,
    options?: { maxResults?: number },
  ): Promise<WebSearchHit[]> {
    const result = await this.client.search({
      text: query,
      num: options?.maxResults ?? DEFAULT_MAX_RESULTS,
    });

    return result.items
      .filter((item) => Boolean(item.url))
      .map((item) => ({
        title: item.title || item.domain || item.url,
        url: item.url,
        content: item.snippet,
      }));
  }
}
