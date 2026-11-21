import { BrightDataWebSearchProvider } from './brightdata-web-search.provider';
import type {
  BrightDataSearchClient,
  SearchResult,
} from '../../integrations/brightdata';
import { BrightDataSerpProviderError } from '../../integrations/brightdata';

describe('BrightDataWebSearchProvider', () => {
  const search = jest.fn();
  const client = { search } as unknown as BrightDataSearchClient;
  const provider = new BrightDataWebSearchProvider(client);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function result(
    items: SearchResult['items'],
    meta: Partial<SearchResult['meta']> = {},
  ): SearchResult {
    return {
      items,
      meta: {
        provider: 'brightdata',
        attempt: 1,
        httpStatus: 200,
        responseBytes: 1,
        elapsedMs: 1,
        emptyBody: false,
        query: 'q',
        resultCategory: 'ok',
        ...meta,
      },
    };
  }

  it('implements WebSearchProvider name', () => {
    expect(provider.name).toBe('brightdata');
  });

  it('maps Bright Data items to WebSearchHit', async () => {
    search.mockResolvedValue(
      result([
        {
          title: 'Movavi',
          url: 'https://movavi.com',
          snippet: 'Video software',
          position: 1,
          domain: 'movavi.com',
        },
      ]),
    );

    const hits = await provider.search('movavi brands');

    expect(search).toHaveBeenCalledWith({
      text: 'movavi brands',
      num: 6,
    });
    expect(hits).toEqual([
      {
        title: 'Movavi',
        url: 'https://movavi.com',
        content: 'Video software',
      },
    ]);
  });

  it('passes maxResults as num', async () => {
    search.mockResolvedValue(result([], { resultCategory: 'organic_empty' }));
    await provider.search('q', { maxResults: 10 });
    expect(search).toHaveBeenCalledWith({ text: 'q', num: 10 });
  });

  it('returns empty list for organic_empty without throwing', async () => {
    search.mockResolvedValue(result([], { resultCategory: 'organic_empty' }));
    await expect(provider.search('q')).resolves.toEqual([]);
  });

  it('returns empty list for consent_page / soft_block / unknown_html without throwing', async () => {
    for (const resultCategory of [
      'consent_page',
      'soft_block',
      'unknown_html',
    ] as const) {
      search.mockResolvedValue(
        result([], { resultCategory, organicResultsCount: 0 }),
      );
      await expect(provider.search('q')).resolves.toEqual([]);
    }
  });

  it('searchWithDiagnostics maps ok → organic_results and exposes telemetry fields', async () => {
    search.mockResolvedValue(
      result(
        [
          {
            title: 'Senic',
            url: 'https://senic.com',
            snippet: 'Audio',
            position: 1,
            domain: 'senic.com',
          },
        ],
        {
          resultCategory: 'ok',
          organicResultsCount: 1,
          responseBytes: 2048,
          elapsedMs: 42,
          attempt: 1,
          zone: 'serp_api',
          query: 'hardware brands',
        },
      ),
    );

    const out = await provider.searchWithDiagnostics('hardware brands');
    expect(out.hits).toHaveLength(1);
    expect(out.diagnostic).toEqual({
      query: 'hardware brands',
      resultCategory: 'organic_results',
      httpStatus: 200,
      responseBytes: 2048,
      latencyMs: 42,
      attempts: 1,
      organicResultsCount: 1,
      zone: 'serp_api',
    });
  });

  it('drops items without url and fills empty title', async () => {
    search.mockResolvedValue(
      result([
        {
          title: '',
          url: '',
          snippet: 'x',
          position: 1,
          domain: '',
        },
        {
          title: '',
          url: 'https://senic.com/about',
          snippet: 'Audio',
          position: 2,
          domain: 'senic.com',
        },
      ]),
    );

    const hits = await provider.search('q');
    expect(hits).toEqual([
      {
        title: 'senic.com',
        url: 'https://senic.com/about',
        content: 'Audio',
      },
    ]);
  });

  it('throws BrightDataSerpProviderError on HTTP 400', async () => {
    search.mockResolvedValue(
      result([], {
        resultCategory: 'http_error',
        httpStatus: 400,
        parseError: 'HTTP_400',
        zone: 'serp_api',
      }),
    );

    await expect(provider.search('q')).rejects.toMatchObject({
      name: 'BrightDataSerpProviderError',
      code: 'BRIGHTDATA_SERP_PROVIDER_ERROR',
      details: {
        resultCategory: 'http_error',
        httpStatus: 400,
        zone: 'serp_api',
        parseError: 'HTTP_400',
      },
    });
    await expect(provider.search('q')).rejects.toBeInstanceOf(
      BrightDataSerpProviderError,
    );
  });

  it('throws BrightDataSerpProviderError on HTTP 401', async () => {
    search.mockResolvedValue(
      result([], {
        resultCategory: 'http_error',
        httpStatus: 401,
        parseError: 'HTTP_401',
      }),
    );

    await expect(provider.search('q')).rejects.toMatchObject({
      details: { resultCategory: 'http_error', httpStatus: 401 },
    });
  });

  it('throws on parse_error', async () => {
    search.mockResolvedValue(
      result([], {
        resultCategory: 'parse_error',
        parseError: 'SERP_RESPONSE_NOT_HTML',
      }),
    );

    await expect(provider.search('q')).rejects.toMatchObject({
      details: {
        resultCategory: 'parse_error',
        parseError: 'SERP_RESPONSE_NOT_HTML',
      },
    });
  });

  it('throws on missing SERP zone config', async () => {
    search.mockResolvedValue(
      result([], {
        resultCategory: 'empty_body',
        parseError: 'BRIGHTDATA_SERP_ZONE_NOT_CONFIGURED',
        httpStatus: 0,
        emptyBody: true,
      }),
    );

    await expect(provider.search('q')).rejects.toMatchObject({
      details: { resultCategory: 'config_error' },
    });
  });
});
