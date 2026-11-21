import { Injectable } from '@nestjs/common';

import type { LlmProvider } from '../interfaces/llm-provider.interface';

@Injectable()
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';

  async complete(prompt?: string): Promise<string> {
    if (prompt && prompt.includes('lead discovery')) {
      return JSON.stringify({
        scraperIds: ['gd_mock_scraper'],
        priorityRoles: ['CEO', 'CMO', 'Marketing Manager'],
        notes: 'Mock lead discovery plan',
      });
    }

    if (prompt && prompt.includes('brand discovery')) {
      return JSON.stringify({
        brands: [
          {
            name: 'Demo Wellness Co',
            website: 'https://www.demowellness.example',
            sector: 'wellness',
            market: 'Spain',
            brandSize: 'smb',
            score: 80,
            fitReason: 'Mock scored brand for tests',
            evidenceUrls: ['https://www.demowellness.example'],
          },
        ],
      });
    }

    // Default: brand-search / contact-research style empty-safe JSON for unit tests
    return JSON.stringify({
      queries: ['mock brand query'],
      scraperIds: ['gd_mock_scraper'],
      priorityRoles: ['CMO'],
      notes: 'Mock LLM default',
    });
  }
}
