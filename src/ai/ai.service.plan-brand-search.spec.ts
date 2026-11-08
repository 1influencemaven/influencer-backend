import { AiService } from './ai.service';
import type { LlmProvider } from './interfaces/llm-provider.interface';
import { parseBrandSearchStrategyPlan } from './schemas/brand-search-strategy.schema';

describe('AiService.planBrandSearch', () => {
  const ibp = {
    targetSectors: ['beauty'],
    excludedSectors: ['gambling'],
    brandSize: ['smb'],
    markets: ['Colombia'],
    collaborationTypes: ['affiliate'],
    summary: 'Beauty creator',
    alertSignals: [],
    desirableCriteria: ['DTC'],
  };

  it('returns parsed queries on first valid response', async () => {
    const complete = jest.fn().mockResolvedValue(
      JSON.stringify({
        queries: ['beauty brands Colombia affiliate program creators'],
      }),
    );
    const service = new AiService({
      name: 'mock',
      model: 'mock',
      complete,
    });

    const plan = await service.planBrandSearch({
      influencerName: 'Ada',
      niche: 'beauty',
      ibp,
      maxQueries: 4,
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(plan.queries).toHaveLength(1);
  });

  it('retries once when first response is invalid JSON', async () => {
    const complete = jest
      .fn()
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce(
        JSON.stringify({
          queries: ['beauty brands Colombia creator partnerships'],
        }),
      );
    const service = new AiService({
      name: 'mock',
      model: 'mock',
      complete,
    });

    const plan = await service.planBrandSearch({
      influencerName: 'Ada',
      niche: 'beauty',
      ibp,
      maxQueries: 4,
    });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(parseBrandSearchStrategyPlan(JSON.stringify(plan)).queries).toEqual(
      plan.queries,
    );
  });
});
