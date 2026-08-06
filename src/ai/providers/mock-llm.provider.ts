import { Injectable } from '@nestjs/common';

import type { IbpOutput } from '../schemas/ibp-output.schema';
import type { LlmProvider } from '../interfaces/llm-provider.interface';

@Injectable()
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';

  async complete(prompt?: string): Promise<string> {
    if (prompt && prompt.includes('lead discovery')) {
      return JSON.stringify({
        tavilyQueries: [
          'Demo Brand CEO LinkedIn',
          'Demo Brand CMO LinkedIn',
          'Demo Brand Marketing Manager LinkedIn',
        ],
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

    const mockOutput: IbpOutput = {
      targetSectors: ['sportswear', 'wellness', 'healthy food'],
      excludedSectors: ['alcohol', 'gambling'],
      brandSize: ['smb', 'mid_market'],
      markets: ['Spain'],
      collaborationTypes: ['product launch', 'brand ambassador'],
      summary:
        'Healthy lifestyle brands in Spain with tangible products and influencer marketing budget.',
      alertSignals: ['body-shaming controversies', 'miracle diet claims'],
      desirableCriteria: ['sustainability', 'authentic messaging'],
    };

    return JSON.stringify(mockOutput);
  }
}
