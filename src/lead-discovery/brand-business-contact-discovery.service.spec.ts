import { CommercialRelevance } from '../generated/prisma/enums';

import { BrandBusinessContactDiscoveryService } from './brand-business-contact-discovery.service';
import * as pageUrls from './utils/brand-business-contact-page-urls.util';

jest.mock('./utils/brand-business-contact-page-urls.util', () => {
  const actual = jest.requireActual<
    typeof import('./utils/brand-business-contact-page-urls.util')
  >('./utils/brand-business-contact-page-urls.util');
  return {
    ...actual,
    normalizeBrandBusinessContactPageUrl: jest.fn(
      (raw: string, base: string) =>
        actual.normalizeBrandBusinessContactPageUrl(raw, base),
    ),
  };
});

describe('BrandBusinessContactDiscoveryService', () => {
  const unlocker = {
    fetchRawHtml: jest.fn(),
    search: jest.fn(),
    isConfigured: jest.fn(() => false),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'MAX_BRAND_BUSINESS_CONTACT_PAGES') return 12;
      if (key === 'MAX_BRAND_BUSINESS_CONTACTS') return 15;
      return undefined;
    }),
  };

  let service: BrandBusinessContactDiscoveryService;
  const normalizeMock =
    pageUrls.normalizeBrandBusinessContactPageUrl as jest.MockedFunction<
      typeof pageUrls.normalizeBrandBusinessContactPageUrl
    >;
  const actualNormalize = jest.requireActual<
    typeof import('./utils/brand-business-contact-page-urls.util')
  >('./utils/brand-business-contact-page-urls.util')
    .normalizeBrandBusinessContactPageUrl;

  beforeEach(() => {
    jest.clearAllMocks();
    unlocker.isConfigured.mockReturnValue(false);
    unlocker.search.mockResolvedValue({
      items: [],
      meta: {
        provider: 'brightdata',
        query: 'q',
        attempt: 1,
        httpStatus: 200,
        responseBytes: 2,
        elapsedMs: 1,
        emptyBody: false,
        resultCategory: 'organic_empty',
      },
    });
    configService.get.mockImplementation((key: string) => {
      if (key === 'MAX_BRAND_BUSINESS_CONTACT_PAGES') return 12;
      if (key === 'MAX_BRAND_BUSINESS_CONTACTS') return 15;
      return undefined;
    });
    normalizeMock.mockImplementation((raw: string, base: string) =>
      actualNormalize(raw, base),
    );
    service = new BrandBusinessContactDiscoveryService(
      unlocker as never,
      configService as never,
    );
  });

  function htmlWith(...emails: string[]) {
    return {
      html: `<p>Reach us at ${emails.join(' or ')} for partnerships</p>`,
      httpStatus: 200,
      elapsedMs: 1,
      emptyBody: false,
      bodyLength: 80,
      zone: 'mcp_unlocker',
      outcome: 'ok' as const,
    };
  }

  function failedFetch(overrides: Record<string, unknown> = {}) {
    return {
      html: '',
      httpStatus: 404,
      elapsedMs: 1,
      emptyBody: true,
      bodyLength: 0,
      zone: 'mcp_unlocker',
      outcome: 'http_error' as const,
      ...overrides,
    };
  }

  it('persists HIGH and UNKNOWN including personal-looking and free-mail', async () => {
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        return htmlWith(
          'partnerships@brand.com',
          'john@brand.com',
          'john@gmail.com',
        );
      }
      return failedFetch();
    });

    const result = await service.discover({
      brandCandidateId: 'b1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    const emails = result.candidates.map((c) => c.emailNormalized).sort();
    expect(emails).toEqual([
      'john@brand.com',
      'john@gmail.com',
      'partnerships@brand.com',
    ]);
    expect(
      result.candidates.find((c) => c.emailNormalized === 'partnerships@brand.com')
        ?.commercialRelevance,
    ).toBe(CommercialRelevance.HIGH);
    expect(
      result.candidates.find((c) => c.emailNormalized === 'john@brand.com')
        ?.commercialRelevance,
    ).toBe(CommercialRelevance.UNKNOWN);
  });

  it('discards LOW and agency domains', async () => {
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        return htmlWith(
          'support@brand.com',
          'noreply@brand.com',
          'agency@agency.com',
          'influencer@brand.com',
        );
      }
      return failedFetch();
    });

    const result = await service.discover({
      brandCandidateId: 'b1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(result.candidates.map((c) => c.emailNormalized)).toEqual([
      'influencer@brand.com',
    ]);
    expect(result.summary.discardCountsByReason).toMatchObject({
      low_relevance: 2,
      external_domain: 1,
    });
  });

  it('keeps generic brand inboxes without a personal name', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'MAX_BRAND_BUSINESS_CONTACT_PAGES') return 12;
      if (key === 'MAX_BRAND_BUSINESS_CONTACTS') return 15;
      return undefined;
    });
    // `/press` is secondary and beyond default maxPages=12 (12 primary paths).
    // Use a primary path so the fixture is actually fetched.
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/contact')) {
        return htmlWith('info@brand.com', 'press@brand.com');
      }
      return failedFetch();
    });

    const result = await service.discover({
      brandCandidateId: 'b1',
      brandName: 'Brand Co',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(result.candidates.map((c) => c.emailNormalized).sort()).toEqual([
      'info@brand.com',
      'press@brand.com',
    ]);
    expect(
      result.candidates.every(
        (c) => c.isGeneric && c.commercialRelevance === CommercialRelevance.HIGH,
      ),
    ).toBe(true);
    expect(result.summary.plannedSearchQueries?.length).toBeGreaterThan(0);
  });

  it('extracts literal emails from Search snippets without inventing addresses', async () => {
    unlocker.isConfigured.mockReturnValue(true);
    unlocker.search.mockResolvedValue({
      items: [
        {
          title: 'Brand partnerships',
          url: 'https://brand.com/partnerships',
          snippet: 'Email partnerships@brand.com for collabs',
          position: 1,
          domain: 'brand.com',
        },
      ],
      meta: {
        provider: 'brightdata',
        query: 'q',
        attempt: 1,
        httpStatus: 200,
        responseBytes: 120,
        elapsedMs: 1,
        emptyBody: false,
        resultCategory: 'ok',
      },
    });
    unlocker.fetchRawHtml.mockResolvedValue(failedFetch());

    const result = await service.discover({
      brandCandidateId: 'b1',
      brandName: 'Brand',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(result.candidates.map((c) => c.emailNormalized)).toContain(
      'partnerships@brand.com',
    );
    expect(result.summary.searchHitsProcessed).toBeGreaterThan(0);
    expect(unlocker.search).toHaveBeenCalled();
    expect(JSON.stringify(result.candidates)).not.toMatch(/invented|fake@/i);
  });

  it('skips invalid website without throwing', async () => {
    const result = await service.discover({
      brandCandidateId: 'b1',
      website: '',
      domain: 'brand.com',
    });
    expect(result.candidates).toEqual([]);
    expect(unlocker.fetchRawHtml).not.toHaveBeenCalled();
  });

  it('counts page failures without aborting and tallies categories', async () => {
    unlocker.fetchRawHtml.mockResolvedValue(
      failedFetch({ httpStatus: 500, outcome: 'http_error' }),
    );

    const result = await service.discover({
      brandCandidateId: 'b1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(result.summary.pagesAttempted).toBe(12);
    expect(result.summary.pagesFailed).toBe(12);
    expect(result.summary.pagesSucceeded).toBe(0);
    expect(result.summary.unlockerZone).toBe('mcp_unlocker');
    expect(result.summary.failureCountsByCategory).toEqual({
      http_error: 12,
    });
    expect(result.summary.pageResults).toHaveLength(12);
    expect(
      result.summary.pagesSucceeded + result.summary.pagesFailed,
    ).toBe(result.summary.pageResults?.length);
    expect(
      Object.values(result.summary.failureCountsByCategory ?? {}).reduce(
        (a, b) => a + b,
        0,
      ),
    ).toBe(result.summary.pagesFailed);
    expect(result.summary.pageResults?.[0]).toMatchObject({
      outcome: 'http_error',
      apiHttpStatus: 500,
      bodyLength: 0,
      elapsedMs: 1,
      zone: 'mcp_unlocker',
    });
    expect(result.candidates).toEqual([]);
  });

  it('records mixed Unlocker outcomes in pageResults', async () => {
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        return htmlWith('partnerships@brand.com');
      }
      if (url.endsWith('/affiliate')) {
        return failedFetch({
          httpStatus: 0,
          elapsedMs: 30_000,
          outcome: 'timeout',
          errorName: 'TimeoutError',
          errorMessage: 'The operation was aborted due to timeout',
        });
      }
      if (url.endsWith('/affiliates')) {
        return failedFetch({
          httpStatus: 0,
          elapsedMs: 12,
          outcome: 'network_error',
          errorName: 'TypeError',
          errorMessage: 'fetch failed',
          causeName: 'Error',
          causeCode: 'ENOTFOUND',
          causeSyscall: 'getaddrinfo',
          causeHostname: 'api.brightdata.com',
        });
      }
      if (url.endsWith('/creators')) {
        return failedFetch({
          httpStatus: 200,
          emptyBody: true,
          outcome: 'empty_body',
        });
      }
      return failedFetch({ httpStatus: 403, outcome: 'http_error' });
    });

    const result = await service.discover({
      brandCandidateId: 'b1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(result.summary.pagesSucceeded).toBe(1);
    expect(result.summary.pagesFailed).toBe(11);
    expect(
      result.summary.pagesSucceeded + result.summary.pagesFailed,
    ).toBe(result.summary.pageResults?.length);
    expect(result.summary.failureCountsByCategory).toMatchObject({
      timeout: 1,
      network_error: 1,
      empty_body: 1,
      http_error: 8,
    });
    const timeoutPage = result.summary.pageResults?.find((p) =>
      p.url.endsWith('/affiliate'),
    );
    expect(timeoutPage).toMatchObject({
      outcome: 'timeout',
      apiHttpStatus: 0,
      elapsedMs: 30_000,
      errorName: 'TimeoutError',
    });
    const networkPage = result.summary.pageResults?.find((p) =>
      p.url.endsWith('/affiliates'),
    );
    expect(networkPage).toMatchObject({
      outcome: 'network_error',
      apiHttpStatus: 0,
      elapsedMs: 12,
      causeCode: 'ENOTFOUND',
      causeSyscall: 'getaddrinfo',
      causeHostname: 'api.brightdata.com',
    });
    expect(
      result.summary.pageResults?.find((p) => p.url.endsWith('/partnerships'))
        ?.outcome,
    ).toBe('ok');
    expect(JSON.stringify(result.summary)).not.toMatch(
      /Bearer\s+\S+|api[_-]?key/i,
    );
  });

  it('records per-page unknown_error without aborting remaining pages', async () => {
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        throw new Error('extract boom');
      }
      if (url.endsWith('/affiliate')) {
        return htmlWith('affiliate@brand.com');
      }
      return failedFetch({ outcome: 'http_error', httpStatus: 404 });
    });

    const result = await service.discover({
      brandCandidateId: 'b1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(result.summary.pagesAttempted).toBe(12);
    expect(result.summary.pagesSucceeded).toBe(1);
    expect(result.summary.pagesFailed).toBe(11);
    expect(result.summary.failureCountsByCategory).toMatchObject({
      unknown_error: 1,
      http_error: 10,
    });
    expect(
      result.summary.pageResults?.find((p) => p.url.endsWith('/partnerships'))
        ?.outcome,
    ).toBe('unknown_error');
    expect(
      result.summary.pageResults?.find((p) => p.url.endsWith('/affiliate'))
        ?.outcome,
    ).toBe('ok');
    expect(result.candidates.map((c) => c.emailNormalized)).toEqual([
      'affiliate@brand.com',
    ]);
  });

  it('records url_normalization_error when post-fetch normalize fails', async () => {
    unlocker.fetchRawHtml.mockResolvedValue(htmlWith('ok@brand.com'));
    // buildBrandBusinessContactPageUrls uses the util's internal normalize;
    // only the service's imported normalize is mocked here.
    normalizeMock.mockReturnValue(null);

    const result = await service.discover({
      brandCandidateId: 'b1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(result.summary.pagesAttempted).toBe(12);
    expect(result.summary.pagesSucceeded).toBe(0);
    expect(result.summary.pagesFailed).toBe(12);
    expect(result.summary.failureCountsByCategory).toEqual({
      url_normalization_error: 12,
    });
    expect(result.summary.pageResults?.[0]?.outcome).toBe(
      'url_normalization_error',
    );
    expect(result.summary.pageResults?.[0]?.apiHttpStatus).toBe(200);
  });
});
