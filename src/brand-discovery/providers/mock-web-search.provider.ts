import { Injectable } from '@nestjs/common';

import type {
  WebSearchHit,
  WebSearchProvider,
} from '../interfaces/web-search-provider.interface';

@Injectable()
export class MockWebSearchProvider implements WebSearchProvider {
  readonly name = 'mock';

  async search(query: string): Promise<WebSearchHit[]> {
    return [
      {
        title: `Demo Brand for ${query}`,
        url: 'https://www.demobrand.example',
        content: `Mock search result related to: ${query}`,
      },
      {
        title: 'FitLife Spain',
        url: 'https://www.fitlife.es',
        content: 'Spanish fitness and wellness brand with influencer campaigns.',
      },
    ];
  }
}
