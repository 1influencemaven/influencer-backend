import { Injectable } from '@nestjs/common';

import type { IbpOutput } from '../schemas/ibp-output.schema';
import type { LlmProvider } from '../interfaces/llm-provider.interface';

@Injectable()
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';

  async complete(): Promise<string> {
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
