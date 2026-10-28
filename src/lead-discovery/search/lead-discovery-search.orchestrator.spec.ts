import { ConfigService } from '@nestjs/config';

import { LeadDiscoverySearchOrchestrator } from './lead-discovery-search.orchestrator';

describe('LeadDiscoverySearchOrchestrator observability', () => {
  const brightDataSearch = {
    search: jest.fn(),
  };

  const configValues: Record<string, string | number | undefined> = {
    LEAD_DISCOVERY_MAX_SEARCH_REQUESTS: 30,
    LEAD_DISCOVERY_MAX_TAVILY_FALLBACK_REQUESTS: 10,
    LEAD_DISCOVERY_SEARCH_FALLBACK: 'none',
  };

  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;

  let orchestrator: LeadDiscoverySearchOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.LEAD_DISCOVERY_SEARCH_FALLBACK = 'none';
    configValues.TAVILY_API_KEY = undefined;
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

  function bdMeta(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      provider: 'brightdata',
      query: 'q',
      attempt: 1,
      httpStatus: 200,
      emptyBody: false,
      responseBytes: 100,
      elapsedMs: 1,
      resultCategory: 'ok',
      ...overrides,
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
      meta: bdMeta(),
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
      meta: bdMeta({ query: text }),
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
        meta: bdMeta({ query: 'q1', responseBytes: 10 }),
      })
      .mockResolvedValue({
        items: Array.from({ length: 5 }, (_, i) =>
          hit(
            `https://linkedin.com/in/u${i}`,
            `U${i} Partnerships Acme Brand`,
            i + 1,
          ),
        ),
        meta: bdMeta({ responseBytes: 10 }),
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

  it('counts network failures with known-zero candidates when BD returns empty', async () => {
    brightDataSearch.search.mockResolvedValue({
      items: [],
      meta: bdMeta({
        httpStatus: 0,
        emptyBody: true,
        responseBytes: 0,
        resultCategory: 'network_error',
      }),
    });

    const result = await orchestrator.discoverProfileUrls({
      brandName: 'Acme Brand',
      website: 'https://acme.com',
      domain: 'acme.com',
      limit: 2,
      priorityRoles: ['Partnerships'],
    });

    expect(result.trace.brightDataSearchFailures).toBe(
      result.trace.brightDataRequests,
    );
    expect(result.trace.failures.every((f) => f.code === 'NETWORK_ERROR')).toBe(
      true,
    );
    expect(result.trace.linkedinUrlValidated).toBe(0);
    expect(result.trace.qualifiedCandidates).toBe(0);
    expect(result.profileUrls).toEqual([]);
    expect(result.searchHitsCount).toBe(0);
    expect(result.trace.brightDataDiagnostics.networkError).toBe(
      result.trace.brightDataRequests,
    );
    expect(result.trace.brightDataDiagnostics.httpStatusCounts['0']).toBe(
      result.trace.brightDataRequests,
    );
  });

  it('keeps searchHits when results are non-LinkedIn and selected URLs stay empty', async () => {
    brightDataSearch.search.mockResolvedValue({
      items: [
        hit('https://example.com/about', 'About Acme Brand', 1),
        hit('https://news.example.com/story', 'Acme Brand news', 2),
      ],
      meta: bdMeta({ resultCategory: 'ok' }),
    });

    const result = await orchestrator.discoverProfileUrls({
      brandName: 'Acme Brand',
      website: 'https://acme.com',
      domain: 'acme.com',
      limit: 2,
      priorityRoles: ['Partnerships'],
    });

    expect(result.searchHitsCount).toBeGreaterThan(0);
    expect(result.trace.linkedinUrlValidated).toBe(0);
    expect(result.trace.qualifiedCandidates).toBe(0);
    expect(result.profileUrls).toEqual([]);
    expect(result.trace.brightDataSearchFailures).toBe(0);
    expect(result.trace.brightDataDiagnostics.hits).toBe(
      result.searchHitsCount,
    );
  });

  it('tallies empty_body vs organic_empty separately in BD diagnostics', async () => {
    brightDataSearch.search
      .mockResolvedValueOnce({
        items: [],
        meta: bdMeta({
          emptyBody: true,
          responseBytes: 0,
          resultCategory: 'empty_body',
        }),
      })
      .mockResolvedValue({
        items: [],
        meta: bdMeta({
          emptyBody: false,
          responseBytes: 24,
          resultCategory: 'organic_empty',
        }),
      });

    const result = await orchestrator.discoverProfileUrls({
      brandName: 'Acme Brand',
      website: 'https://acme.com',
      domain: 'acme.com',
      limit: 2,
      priorityRoles: ['Partnerships'],
    });

    expect(result.trace.brightDataDiagnostics.emptyBody).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      result.trace.brightDataDiagnostics.organicEmpty,
    ).toBeGreaterThanOrEqual(1);
    expect(result.trace.brightDataSearchFailures).toBeGreaterThanOrEqual(1);
    expect(
      result.trace.failures.some((f) => f.code === 'EMPTY_BODY'),
    ).toBe(true);
  });

  describe('Tavily fallback diagnostics', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
      configValues.LEAD_DISCOVERY_SEARCH_FALLBACK = 'tavily';
      configValues.TAVILY_API_KEY = 'test-tavily-key';
      configValues.LEAD_DISCOVERY_MAX_TAVILY_FALLBACK_REQUESTS = 3;
      configValues.LEAD_DISCOVERY_MAX_SEARCH_REQUESTS = 1;
      orchestrator = new LeadDiscoverySearchOrchestrator(
        brightDataSearch as never,
        configService,
      );
      fetchMock = jest.fn();
      global.fetch = fetchMock;

      brightDataSearch.search.mockResolvedValue({
        items: [],
        meta: bdMeta({
          emptyBody: true,
          responseBytes: 0,
          resultCategory: 'empty_body',
        }),
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('records httpOkEmptyResults when Tavily returns results: []', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      const result = await orchestrator.discoverProfileUrls({
        brandName: 'Acme Brand',
        website: 'https://acme.com',
        domain: 'acme.com',
        limit: 2,
        priorityRoles: ['Partnerships'],
      });

      expect(result.trace.fallbackActivated).toBe(true);
      expect(result.trace.tavilyDiagnostics.httpOkEmptyResults).toBeGreaterThan(
        0,
      );
      expect(result.trace.tavilyDiagnostics.httpOkWithResults).toBe(0);
      expect(result.trace.tavilyDiagnostics.httpError).toBe(0);
      expect(result.trace.tavilyDiagnostics.hits).toBe(0);
    });

    it('records httpOkWithResults when Tavily returns hits', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              url: 'https://www.linkedin.com/in/ada-partnerships',
              title: 'Ada — Partnerships at Acme Brand',
              content: 'Partnerships Acme Brand',
            },
          ],
        }),
      });

      const result = await orchestrator.discoverProfileUrls({
        brandName: 'Acme Brand',
        website: 'https://acme.com',
        domain: 'acme.com',
        limit: 2,
        priorityRoles: ['Partnerships'],
      });

      expect(result.trace.tavilyDiagnostics.httpOkWithResults).toBeGreaterThan(
        0,
      );
      expect(result.trace.tavilyDiagnostics.hits).toBeGreaterThan(0);
      expect(result.searchHitsCount).toBeGreaterThan(0);
    });

    it('records HTTP 403 and 500 as httpError', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({}),
        })
        .mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({}),
        });

      const result = await orchestrator.discoverProfileUrls({
        brandName: 'Acme Brand',
        website: 'https://acme.com',
        domain: 'acme.com',
        limit: 2,
        priorityRoles: ['Partnerships'],
      });

      expect(result.trace.tavilyDiagnostics.httpError).toBe(
        result.trace.tavilyDiagnostics.requests,
      );
      expect(
        result.trace.failures.filter((f) => f.code === 'HTTP_ERROR').length,
      ).toBeGreaterThan(0);
    });

    it('records network exceptions separately from HTTP errors', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await orchestrator.discoverProfileUrls({
        brandName: 'Acme Brand',
        website: 'https://acme.com',
        domain: 'acme.com',
        limit: 2,
        priorityRoles: ['Partnerships'],
      });

      expect(result.trace.tavilyDiagnostics.networkError).toBe(
        result.trace.tavilyDiagnostics.requests,
      );
      expect(
        result.trace.failures.every((f) => f.code === 'NETWORK_ERROR' || f.code === 'EMPTY_BODY'),
      ).toBe(true);
    });

    it('records timeouts as TIMEOUT', async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      fetchMock.mockRejectedValue(err);

      const result = await orchestrator.discoverProfileUrls({
        brandName: 'Acme Brand',
        website: 'https://acme.com',
        domain: 'acme.com',
        limit: 2,
        priorityRoles: ['Partnerships'],
      });

      expect(result.trace.tavilyDiagnostics.timeout).toBe(
        result.trace.tavilyDiagnostics.requests,
      );
      expect(result.trace.failures.some((f) => f.code === 'TIMEOUT')).toBe(true);
    });
  });
});
