import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrightDataSearchClient } from './brightdata-search.client';

function mockConfig(
  overrides: Record<string, string | number> = {},
): ConfigService {
  const values: Record<string, string | number> = {
    BRIGHTDATA_API_KEY: 'test-key',
    BRIGHTDATA_SERP_ZONE: 'serp_demo',
    BRIGHTDATA_UNLOCKER_ZONE: 'mcp_unlocker',
    BRIGHTDATA_SEARCH_TIMEOUT_MS: 5000,
    BRIGHTDATA_SEARCH_MAX_RETRIES: 0,
    BRIGHTDATA_SEARCH_RETRY_BACKOFF_MS: 1,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('BrightDataSearchClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses BRIGHTDATA_SERP_ZONE for search and never Unlocker zone', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ organic: [] }),
    });
    const client = new BrightDataSearchClient(mockConfig());
    await client.search({ text: 'brand partnerships' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      zone: string;
    };
    expect(body.zone).toBe('serp_demo');
    expect(body.zone).not.toBe('mcp_unlocker');
  });

  it('uses BRIGHTDATA_UNLOCKER_ZONE for fetchRawHtml, not SERP zone', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () => '<html>ok</html>',
    });
    const client = new BrightDataSearchClient(mockConfig());
    const result = await client.fetchRawHtml('https://brand.com/contact');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      zone: string;
    };
    expect(body.zone).toBe('mcp_unlocker');
    expect(result.zone).toBe('mcp_unlocker');
    expect(body.zone).not.toBe('serp_demo');
  });

  it('does not call Bright Data when SERP zone is missing', async () => {
    const client = new BrightDataSearchClient(
      mockConfig({ BRIGHTDATA_SERP_ZONE: '' }),
    );
    const result = await client.search({ text: 'test' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.meta.parseError).toBe('BRIGHTDATA_SERP_ZONE_NOT_CONFIGURED');
    expect(result.meta.emptyBody).toBe(true);
  });

  it('parses organic JSON into search items', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          organic: [
            {
              title: 'Mariano Said - Liquid IV',
              link: 'https://www.linkedin.com/in/marianosaid',
              description: 'Influencer marketing at Liquid IV',
            },
          ],
        }),
    });

    const client = new BrightDataSearchClient(mockConfig());
    const result = await client.search({ text: 'Liquid IV partnerships' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].url).toBe(
      'https://www.linkedin.com/in/marianosaid',
    );
    expect(result.items[0].position).toBe(1);
    expect(result.meta.emptyBody).toBe(false);
    expect(result.meta.provider).toBe('brightdata');
    expect(result.meta.resultCategory).toBe('ok');
    expect(result.meta.responseBytes).toBeGreaterThan(0);
    expect(result.meta.httpStatus).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty items on HTTP 200 with empty body', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () => '',
    });

    const client = new BrightDataSearchClient(mockConfig());
    const result = await client.search({ text: 'test query' });

    expect(result.items).toHaveLength(0);
    expect(result.meta.emptyBody).toBe(true);
    expect(result.meta.httpStatus).toBe(200);
    expect(result.meta.responseBytes).toBe(0);
    expect(result.meta.resultCategory).toBe('empty_body');
  });

  it('classifies valid JSON with organic: [] as organic_empty', async () => {
    const body = JSON.stringify({ organic: [] });
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () => body,
    });

    const client = new BrightDataSearchClient(mockConfig());
    const result = await client.search({ text: 'test query' });

    expect(result.items).toHaveLength(0);
    expect(result.meta.emptyBody).toBe(false);
    expect(result.meta.httpStatus).toBe(200);
    expect(result.meta.responseBytes).toBe(body.length);
    expect(result.meta.resultCategory).toBe('organic_empty');
    expect(result.meta.parseError).toBeUndefined();
  });

  it('classifies organic rows without a valid URL as organic_empty', async () => {
    const body = JSON.stringify({
      organic: [
        { title: 'No link here', description: 'missing url' },
        { title: 'Blank link', link: '   ', description: 'blank' },
      ],
    });
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () => body,
    });

    const client = new BrightDataSearchClient(mockConfig());
    const result = await client.search({ text: 'test query' });

    expect(result.items).toHaveLength(0);
    expect(result.meta.resultCategory).toBe('organic_empty');
    expect(result.meta.responseBytes).toBe(body.length);
    expect(result.meta.httpStatus).toBe(200);
  });

  it('records parse error when body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () => 'not-json',
    });

    const client = new BrightDataSearchClient(mockConfig());
    const result = await client.search({ text: 'test query' });

    expect(result.items).toHaveLength(0);
    expect(result.meta.parseError).toBeDefined();
    expect(result.meta.emptyBody).toBe(false);
    expect(result.meta.resultCategory).toBe('parse_error');
    expect(result.meta.responseBytes).toBe('not-json'.length);
  });

  it('classifies HTTP 403/500 as http_error without treating empty organic', async () => {
    fetchMock.mockResolvedValue({
      status: 403,
      text: async () => 'forbidden',
    });

    const client = new BrightDataSearchClient(mockConfig());
    const result = await client.search({ text: 'test query' });

    expect(result.items).toHaveLength(0);
    expect(result.meta.httpStatus).toBe(403);
    expect(result.meta.responseBytes).toBe('forbidden'.length);
    expect(result.meta.resultCategory).toBe('http_error');
  });

  it('classifies network exceptions as network_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const client = new BrightDataSearchClient(mockConfig());
    const result = await client.search({ text: 'test query' });

    expect(result.items).toHaveLength(0);
    expect(result.meta.httpStatus).toBe(0);
    expect(result.meta.responseBytes).toBe(0);
    expect(result.meta.resultCategory).toBe('network_error');
  });

  function fetchFailedWithCause(causeFields: Record<string, unknown>) {
    const cause = Object.assign(
      new Error(String(causeFields.message ?? 'transport failed')),
      causeFields,
    );
    const err = new TypeError('fetch failed');
    Object.defineProperty(err, 'cause', { value: cause });
    return err;
  }

  describe('transport failure logging preserves original cause', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    function lastWarnPayload(): Record<string, unknown> {
      expect(warnSpy).toHaveBeenCalled();
      const raw = String(warnSpy.mock.calls[0][0]);
      return JSON.parse(raw) as Record<string, unknown>;
    }

    it('logs ENOTFOUND cause and marks failureKind=transport', async () => {
      fetchMock.mockRejectedValue(
        fetchFailedWithCause({
          code: 'ENOTFOUND',
          syscall: 'getaddrinfo',
          hostname: 'api.brightdata.com',
          message: 'getaddrinfo ENOTFOUND api.brightdata.com',
        }),
      );

      const client = new BrightDataSearchClient(mockConfig());
      const result = await client.search({ text: 'dns fail' });

      expect(result.meta.resultCategory).toBe('network_error');
      expect(result.meta.httpStatus).toBe(0);
      expect(result.meta.parseError).toMatch(/ENOTFOUND/);

      const payload = lastWarnPayload();
      expect(payload.failureKind).toBe('transport');
      expect(payload.apiHostname).toBe('api.brightdata.com');
      expect(payload.apiProtocol).toBe('https');
      expect(payload.httpMethod).toBe('POST');
      expect(payload.apiPath).toBe('/request');
      expect(payload.apiHttpStatus).toBe(0);
      expect(payload.causeCode).toBe('ENOTFOUND');
      expect(payload.causeSyscall).toBe('getaddrinfo');
      expect(payload.causeHostname).toBe('api.brightdata.com');
      expect(JSON.stringify(payload)).not.toMatch(/test-key|Bearer|Authorization/i);
    });

    it('logs ECONNRESET as transport cause', async () => {
      fetchMock.mockRejectedValue(
        fetchFailedWithCause({
          code: 'ECONNRESET',
          syscall: 'read',
          message: 'read ECONNRESET',
        }),
      );

      const client = new BrightDataSearchClient(mockConfig());
      await client.search({ text: 'reset' });

      const payload = lastWarnPayload();
      expect(payload.failureKind).toBe('transport');
      expect(payload.causeCode).toBe('ECONNRESET');
      expect(payload.unlockerOutcome).toBe('network_error');
    });

    it('logs timeout as transport with unlockerOutcome=timeout', async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      fetchMock.mockRejectedValue(err);

      const client = new BrightDataSearchClient(mockConfig());
      await client.search({ text: 'timeout' });

      const payload = lastWarnPayload();
      expect(payload.failureKind).toBe('transport');
      expect(payload.unlockerOutcome).toBe('timeout');
      expect(payload.apiHttpStatus).toBe(0);
      expect(payload.errorName).toBe('TimeoutError');
    });

    it('logs TLS certificate cause codes', async () => {
      fetchMock.mockRejectedValue(
        fetchFailedWithCause({
          code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          message: 'unable to verify the first certificate',
        }),
      );

      const client = new BrightDataSearchClient(mockConfig());
      await client.search({ text: 'tls' });

      const payload = lastWarnPayload();
      expect(payload.failureKind).toBe('transport');
      expect(payload.causeCode).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
      expect(payload.unlockerOutcome).toBe('network_error');
    });

    it('marks HTTP status responses as failureKind=http (not transport)', async () => {
      fetchMock.mockResolvedValue({
        status: 401,
        text: async () => 'unauthorized',
      });

      const client = new BrightDataSearchClient(mockConfig());
      const result = await client.search({ text: 'auth' });

      expect(result.meta.resultCategory).toBe('http_error');
      expect(result.meta.httpStatus).toBe(401);
      const payload = lastWarnPayload();
      expect(payload.failureKind).toBe('http');
      expect(payload.apiHttpStatus).toBe(401);
      expect(payload.causeCode).toBeUndefined();
    });
  });

  it('retries on empty body when max retries allows', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        text: async () => '',
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            organic: [
              {
                title: 'Profile',
                link: 'https://www.linkedin.com/in/retry-ok',
              },
            ],
          }),
      });

    const client = new BrightDataSearchClient(
      mockConfig({ BRIGHTDATA_SEARCH_MAX_RETRIES: 1 }),
    );
    const result = await client.search({ text: 'retry query' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].url).toBe('https://www.linkedin.com/in/retry-ok');
  });

  it('reports not configured without API key', () => {
    const client = new BrightDataSearchClient(
      mockConfig({ BRIGHTDATA_API_KEY: '' }),
    );
    expect(client.isConfigured()).toBe(false);
  });

  describe('fetchRawHtml', () => {
    it('returns ok with HTML on successful API response', async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        text: async () => '<html>hello</html>',
      });

      const client = new BrightDataSearchClient(mockConfig());
      const result = await client.fetchRawHtml('https://brand.com/contact');

      expect(result.outcome).toBe('ok');
      expect(result.html).toContain('hello');
      expect(result.httpStatus).toBe(200);
      expect(result.bodyLength).toBeGreaterThan(0);
      expect(result.emptyBody).toBe(false);
      expect(result.zone).toBe('mcp_unlocker');
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('returns http_error on non-2xx API status', async () => {
      fetchMock.mockResolvedValue({
        status: 429,
        text: async () => 'rate limited',
      });

      const client = new BrightDataSearchClient(mockConfig());
      const result = await client.fetchRawHtml('https://brand.com/contact');

      expect(result.outcome).toBe('http_error');
      expect(result.httpStatus).toBe(429);
      expect(result.bodyLength).toBeGreaterThan(0);
      expect(result.html).toBe('rate limited');
    });

    it('returns empty_body on 200 with empty body', async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        text: async () => '',
      });

      const client = new BrightDataSearchClient(mockConfig());
      const result = await client.fetchRawHtml('https://brand.com/contact');

      expect(result.outcome).toBe('empty_body');
      expect(result.emptyBody).toBe(true);
      expect(result.bodyLength).toBe(0);
      expect(result.httpStatus).toBe(200);
    });

    it('returns timeout on AbortError / TimeoutError', async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      fetchMock.mockRejectedValue(err);

      const client = new BrightDataSearchClient(mockConfig());
      const result = await client.fetchRawHtml('https://brand.com/contact');

      expect(result.outcome).toBe('timeout');
      expect(result.httpStatus).toBe(0);
      expect(result.html).toBe('');
      expect(result.errorName).toBe('TimeoutError');
    });

    it('returns network_error on transport failure', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const client = new BrightDataSearchClient(mockConfig());
      const result = await client.fetchRawHtml('https://brand.com/contact');

      expect(result.outcome).toBe('network_error');
      expect(result.httpStatus).toBe(0);
      expect(result.errorName).toBe('TypeError');
      expect(result.errorMessage).toContain('fetch failed');
    });

    it('exposes sanitized cause diagnostics for fetch failed', async () => {
      const cause = Object.assign(
        new Error('getaddrinfo ENOTFOUND api.brightdata.com'),
        {
          code: 'ENOTFOUND',
          syscall: 'getaddrinfo',
          hostname: 'api.brightdata.com',
        },
      );
      const err = new TypeError('fetch failed');
      Object.defineProperty(err, 'cause', { value: cause });
      fetchMock.mockRejectedValue(err);

      const client = new BrightDataSearchClient(mockConfig());
      const result = await client.fetchRawHtml('https://brand.com/contact');

      expect(result.outcome).toBe('network_error');
      expect(result.causeCode).toBe('ENOTFOUND');
      expect(result.causeSyscall).toBe('getaddrinfo');
      expect(result.causeHostname).toBe('api.brightdata.com');
      expect(JSON.stringify(result)).not.toMatch(/Bearer|api_key/);
    });

    it('does not expose secrets in result or warn logs', async () => {
      const loggerWarn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      fetchMock.mockRejectedValue(
        new Error('Authorization: Bearer super-secret-token api_key=abc'),
      );

      const client = new BrightDataSearchClient(mockConfig());
      const result = await client.fetchRawHtml('https://brand.com/contact');

      expect(result.errorMessage).not.toMatch(/super-secret|api_key=abc/);
      expect(result.errorMessage).toContain('[REDACTED]');
      const logged = loggerWarn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toMatch(/super-secret-token|api_key=abc/);
      expect(logged).toContain('[REDACTED]');

      loggerWarn.mockRestore();
    });
  });
});
