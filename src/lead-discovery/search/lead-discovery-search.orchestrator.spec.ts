import { ConfigService } from '@nestjs/config';

import { LeadDiscoverySearchOrchestrator } from './lead-discovery-search.orchestrator';

describe('LeadDiscoverySearchOrchestrator observability', () => {
  const brightDataSearch = {
    search: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'LEAD_DISCOVERY_MAX_SEARCH_REQUESTS') return 30;
      if (key === 'LEAD_DISCOVERY_MAX_TAVILY_FALLBACK_REQUESTS') return 10;
      if (key === 'LEAD_DISCOVERY_SEARCH_FALLBACK') return 'none';
      return undefined;
    }),
  } as unknown as ConfigService;

  let orchestrator: LeadDiscoverySearchOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new LeadDiscoverySearchOrchestrator(
      brightDataSearch as never,
      configService,
    );
  });

  function hit(url: string, title: string, position = 1) {
    return {
      title,
      url,
      snippet: title,
      position,
      domain: 'linkedin.com',
    };
  }

  it('exposes planned vs executed queries and searchHitsCount', async () => {
    brightDataSearch.search.mockResolvedValue({
      items: [
        hit(
          'https://linkedin.com/in/ada',
          'Ada — Partnerships at Acme Brand',
          1,
        ),
        hit(
          'https://linkedin.com/in/bob',
          'Bob — Marketing at Acme Brand',
          2,
        ),
      ],
      meta: {
        provider: 'brightdata',
        query: 'q',
        attempt: 1,
        httpStatus: 200,
        emptyBody: false,
        responseBytes: 100,
        elapsedMs: 1,
      },
    });

    const result = await orchestrator.discoverProfileUrls({
      brandName: 'Acme Brand',
      website: 'https://acme.com',
      domain: 'acme.com',
      limit: 2,
      priorityRoles: ['Partnerships'],
    });

    expect(result.plannedQueries.length).toBeGreaterThan(0);
    expect(result.executedQueries.length).toBeGreaterThan(0);
    expect(result.executedQueries.length).toBeLessThanOrEqual(
      result.plannedQueries.length,
    );
    expect(result.searchHitsCount).toBe(
      2 * result.executedQueries.length,
    );
    expect(result.trace.queriesExecuted).toBe(result.executedQueries.length);
  });

  it('does not include unsent ladder queries after early-stop', async () => {
    // High-quality hits so threshold is met quickly (limit=3 → minRequired=3)
    brightDataSearch.search.mockImplementation(async ({ text }: { text: string }) => ({
      items: [
        hit('https://linkedin.com/in/p1', `P1 Partnerships Acme Brand ${text}`, 1),
        hit('https://linkedin.com/in/p2', `P2 Partnerships Acme Brand ${text}`, 2),
        hit('https://linkedin.com/in/p3', `P3 Partnerships Acme Brand ${text}`, 3),
      ],
      meta: {
        provider: 'brightdata',
        query: text,
        attempt: 1,
        httpStatus: 200,
        emptyBody: false,
        responseBytes: 100,
        elapsedMs: 1,
      },
    }));

    const result = await orchestrator.discoverProfileUrls({
      brandName: 'Acme Brand',
      website: 'https://acme.com',
      domain: 'acme.com',
      limit: 3,
      priorityRoles: ['Partnerships', 'CMO', 'CEO', 'Founder'],
    });

    expect(result.plannedQueries.length).toBeGreaterThan(
      result.executedQueries.length,
    );
    expect(result.executedQueries.every((q) => result.plannedQueries.includes(q))).toBe(
      true,
    );
  });

  it('sums Bright Data item counts into searchHitsCount (not profile URLs)', async () => {
    brightDataSearch.search
      .mockResolvedValueOnce({
        items: [
          hit('https://linkedin.com/in/a', 'A Partnerships Acme', 1),
          hit('https://example.com/x', 'noise', 2),
          hit('https://linkedin.com/in/b', 'B Partnerships Acme', 3),
        ],
        meta: {
          provider: 'brightdata',
          query: 'q1',
          attempt: 1,
          httpStatus: 200,
          emptyBody: false,
          responseBytes: 10,
          elapsedMs: 1,
        },
      })
      .mockResolvedValue({
        items: Array.from({ length: 5 }, (_, i) =>
          hit(
            `https://linkedin.com/in/u${i}`,
            `U${i} Partnerships Acme Brand`,
            i + 1,
          ),
        ),
        meta: {
          provider: 'brightdata',
          query: 'q',
          attempt: 1,
          httpStatus: 200,
          emptyBody: false,
          responseBytes: 10,
          elapsedMs: 1,
        },
      });

    const result = await orchestrator.discoverProfileUrls({
      brandName: 'Acme Brand',
      website: 'https://acme.com',
      domain: 'acme.com',
      limit: 1,
      priorityRoles: ['Partnerships'],
    });

    // First call alone may early-stop if enough qualified; assert hits >= items returned
    expect(result.searchHitsCount).toBeGreaterThanOrEqual(3);
    expect(result.searchHitsCount).not.toBe(result.profileUrls.length);
  });
});
