import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  WebSearchHit,
  WebSearchProvider,
} from '../interfaces/web-search-provider.interface';

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
};

@Injectable()
export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly name = 'tavily';
  private readonly logger = new Logger(TavilyWebSearchProvider.name);
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.getOrThrow<string>('TAVILY_API_KEY');
  }

  async search(
    query: string,
    options?: { maxResults?: number },
  ): Promise<WebSearchHit[]> {
    const maxResults = options?.maxResults ?? 8;

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Tavily search failed: ${response.status} ${body}`);
      throw new Error(`Tavily search failed with status ${response.status}`);
    }

    const data = (await response.json()) as TavilyResponse;

    return (data.results ?? [])
      .filter((hit) => hit.url && hit.title)
      .map((hit) => ({
        title: hit.title ?? '',
        url: hit.url ?? '',
        content: hit.content ?? '',
      }));
  }
}
