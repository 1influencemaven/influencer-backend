import { ConfigService } from '@nestjs/config';

import { AiService } from '../../ai/ai.service';
import { buildBrandDiscoveryQueries } from '../../ai/prompts/generate-brand-discovery.prompt';
import type { BrandSourceContext } from '../interfaces/brand-source-provider.interface';
import type { WebSearchProvider } from '../interfaces/web-search-provider.interface';
import { AiPlusTavilyBrandSource } from './ai-plus-tavily.brand-source';

describe('AiPlusTavilyBrandSource', () => {
  const ibp: BrandSourceContext['ibp'] = {
    targetSectors: ['software'],
    excludedSectors: [],
    brandSize: ['smb'],
    markets: ['Global'],
    collaborationTypes: [],
    summary: '',
    alertSignals: [],
    desirableCriteria: [],
  };

  const context: BrandSourceContext = {
    influencerName: 'Ada',
    influencerNiche: 'tech',
    ibp,
    limit: 5,
    promptInstructions: 'Score brands',
  };

  const hit = {
    title: 'Movavi',
    url: 'https://movavi.com',
    content: 'Video software',
  };

  function createSource(opts: {
    strategy?: 'llm' | 'templates';
    planBrandSearch?: jest.Mock;
    scoreBrandCandidates?: jest.Mock;
    search?: jest.Mock;
  }) {
    const search = opts.search ?? jest.fn().mockResolvedValue([hit]);
    const scoreBrandCandidates =
      opts.scoreBrandCandidates ??
      jest.fn().mockResolvedValue({
        brands: [
          {
            name: 'Movavi',
            website: 'https://movavi.com',
            sector: 'software',
            market: 'Global',
            brandSize: 'smb',
            score: 90,
            fitReason: 'fit',
            evidenceUrls: ['https://movavi.com'],
          },
        ],
      });
    const planBrandSearch =
      opts.planBrandSearch ??
      jest.fn().mockResolvedValue({
        queries: [
          'software brands Global creator partnerships',
          'software companies Global affiliate program',
        ],
      });

    const configService = {
      get: jest.fn((key: string) =>
        key === 'BRAND_SEARCH_STRATEGY' ? (opts.strategy ?? 'llm') : undefined,
      ),
    } as unknown as ConfigService;

    const source = new AiPlusTavilyBrandSource(
      { name: 'brightdata', search },
      { scoreBrandCandidates, planBrandSearch } as unknown as AiService,
      configService,
    );

    return { source, search, scoreBrandCandidates, planBrandSearch };
  }

  it('LLM success: metadata reflects validated queries and hits', async () => {
    const planned = [
      'software brands Global creator partnerships',
      'software companies Global affiliate program',
    ];
    const { source, search, scoreBrandCandidates, planBrandSearch } =
      createSource({
        planBrandSearch: jest.fn().mockResolvedValue({ queries: planned }),
      });

    const result = await source.discover(context);

    expect(planBrandSearch).toHaveBeenCalled();
    // Second planned query shares category signature → mode_quota keeps 1
    expect(search).toHaveBeenCalledTimes(1);
    expect(scoreBrandCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ searchHits: [hit] }),
    );
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({ name: 'Movavi', source: 'ai+brightdata' }),
    );
    expect(result.searchMetadata).toEqual({
      strategy: 'llm',
      queries: [planned[0]],
      plannedQueriesCount: 2,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      searchHitsCount: 1,
    });
  });

  it('drops invalid planned queries from search and metadata', async () => {
    const { source, search } = createSource({
      planBrandSearch: jest.fn().mockResolvedValue({
        queries: [
          'software brands Global creator partnerships',
          'best brands in software',
          'software companies Global affiliate program xx',
          'top brands Global',
        ],
      }),
    });

    const result = await source.discover(context);

    expect(result.searchMetadata?.plannedQueriesCount).toBe(4);
    // listicle + mode_quota (same category as first) → 1 kept
    expect(result.searchMetadata?.validatedQueriesCount).toBe(1);
    expect(result.searchMetadata?.queries).toEqual([
      'software brands Global creator partnerships',
    ]);
    expect(result.searchMetadata?.fallbackUsed).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.searchMetadata?.searchHitsCount).toBe(1);
  });

  it('falls back to templates when planBrandSearch fails', async () => {
    const { source, search, planBrandSearch } = createSource({
      planBrandSearch: jest.fn().mockRejectedValue(new Error('llm down')),
    });

    const result = await source.discover(context);
    const fallback = buildBrandDiscoveryQueries(
      ibp,
      context.influencerName,
      context.influencerNiche,
    );

    expect(planBrandSearch).toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(fallback.length);
    expect(result.searchMetadata).toEqual({
      strategy: 'llm',
      queries: fallback,
      plannedQueriesCount: 0,
      validatedQueriesCount: fallback.length,
      fallbackUsed: true,
      searchHitsCount: 1,
    });
  });

  it('falls back when all planned queries are invalidated', async () => {
    const { source, search } = createSource({
      planBrandSearch: jest.fn().mockResolvedValue({
        queries: ['best brands in software', 'top brands Global'],
      }),
    });

    const result = await source.discover(context);
    const fallback = buildBrandDiscoveryQueries(
      ibp,
      context.influencerName,
      context.influencerNiche,
    );

    expect(result.searchMetadata).toEqual({
      strategy: 'llm',
      queries: fallback,
      plannedQueriesCount: 2,
      validatedQueriesCount: fallback.length,
      fallbackUsed: true,
      searchHitsCount: 1,
    });
    expect(search).toHaveBeenCalledTimes(fallback.length);
  });

  it('templates mode: planned equals validated, no planBrandSearch', async () => {
    const { source, search, planBrandSearch } = createSource({
      strategy: 'templates',
    });

    const result = await source.discover(context);
    const templates = buildBrandDiscoveryQueries(
      ibp,
      context.influencerName,
      context.influencerNiche,
    );

    expect(planBrandSearch).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(templates.length);
    expect(result.searchMetadata).toEqual({
      strategy: 'templates',
      queries: templates,
      plannedQueriesCount: templates.length,
      validatedQueriesCount: templates.length,
      fallbackUsed: false,
      searchHitsCount: 1,
    });
  });
});
