import type { BrightDataSearchClient } from '../../integrations/brightdata';

import { BrightDataUnlockerAdapter } from './bright-data-unlocker.adapter';

describe('BrightDataUnlockerAdapter', () => {
  const fetchRawHtml = jest.fn();
  const search = jest.fn();
  const isConfigured = jest.fn(() => true);

  const client = {
    fetchRawHtml,
    search,
    isConfigured,
  } as unknown as BrightDataSearchClient;

  let adapter: BrightDataUnlockerAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    isConfigured.mockReturnValue(true);
    adapter = new BrightDataUnlockerAdapter(client);
  });

  it('reports isConfigured from the client', () => {
    isConfigured.mockReturnValue(false);
    expect(adapter.isConfigured()).toBe(false);
  });

  describe('fetchHtml', () => {
    it('maps ok HTML', async () => {
      fetchRawHtml.mockResolvedValue({
        html: '<html>hi</html>',
        httpStatus: 200,
        elapsedMs: 10,
        emptyBody: false,
        bodyLength: 14,
        zone: 'mcp_unlocker',
        outcome: 'ok',
      });

      const result = await adapter.fetchHtml('https://brand.com/contact');
      expect(result.outcome).toBe('ok');
      expect(result.html).toContain('hi');
      expect(result.providerFailureKind).toBeNull();
    });

    it('maps empty_body', async () => {
      fetchRawHtml.mockResolvedValue({
        html: '',
        httpStatus: 200,
        elapsedMs: 5,
        emptyBody: true,
        bodyLength: 0,
        zone: 'mcp_unlocker',
        outcome: 'empty_body',
      });

      const result = await adapter.fetchHtml('https://brand.com/contact');
      expect(result.outcome).toBe('empty_body');
      expect(result.html).toBe('');
      expect(result.providerFailureKind).toBe('empty_body');
    });

    it('maps HTTP 504', async () => {
      fetchRawHtml.mockResolvedValue({
        html: 'gateway',
        httpStatus: 504,
        elapsedMs: 5,
        emptyBody: false,
        bodyLength: 7,
        zone: 'mcp_unlocker',
        outcome: 'http_error',
      });

      const result = await adapter.fetchHtml('https://brand.com/contact');
      expect(result.outcome).toBe('http_error');
      expect(result.providerFailureKind).toBe('http');
      expect(result.httpStatus).toBe(504);
    });

    it('maps DNS / network transport failure', async () => {
      fetchRawHtml.mockResolvedValue({
        html: '',
        httpStatus: 0,
        elapsedMs: 3,
        emptyBody: true,
        bodyLength: 0,
        zone: 'mcp_unlocker',
        outcome: 'network_error',
        errorName: 'TypeError',
        errorMessage: 'fetch failed',
        causeCode: 'ENOTFOUND',
        causeHostname: 'api.brightdata.com',
      });

      const result = await adapter.fetchHtml('https://brand.com/contact');
      expect(result.outcome).toBe('network_error');
      expect(result.providerFailureKind).toBe('transport');
      expect(result.causeCode).toBe('ENOTFOUND');
    });
  });

  describe('search', () => {
    it('maps ok with organic items', async () => {
      search.mockResolvedValue({
        items: [
          {
            title: 'Contact',
            url: 'https://brand.com/contact',
            snippet: 'email us',
            position: 1,
            domain: 'brand.com',
          },
        ],
        meta: {
          provider: 'brightdata',
          zone: 'mcp_unlocker',
          attempt: 1,
          httpStatus: 200,
          responseBytes: 100,
          elapsedMs: 20,
          emptyBody: false,
          query: 'brand contact',
          resultCategory: 'ok',
        },
      });

      const result = await adapter.search({ text: 'brand contact', num: 5 });
      expect(result.outcome).toBe('ok');
      expect(result.items).toHaveLength(1);
      expect(result.providerFailureKind).toBeNull();
    });

    it('maps organic_empty as non-failure (valid no matches at SERP layer)', async () => {
      search.mockResolvedValue({
        items: [],
        meta: {
          provider: 'brightdata',
          zone: 'mcp_unlocker',
          attempt: 1,
          httpStatus: 200,
          responseBytes: 20,
          elapsedMs: 10,
          emptyBody: false,
          query: 'brand',
          resultCategory: 'organic_empty',
        },
      });

      const result = await adapter.search({ text: 'brand' });
      expect(result.outcome).toBe('organic_empty');
      expect(result.providerFailureKind).toBeNull();
    });

    it('maps empty_body', async () => {
      search.mockResolvedValue({
        items: [],
        meta: {
          provider: 'brightdata',
          zone: 'mcp_unlocker',
          attempt: 1,
          httpStatus: 200,
          responseBytes: 0,
          elapsedMs: 5,
          emptyBody: true,
          query: 'brand',
          resultCategory: 'empty_body',
        },
      });

      const result = await adapter.search({ text: 'brand' });
      expect(result.outcome).toBe('empty_body');
      expect(result.providerFailureKind).toBe('empty_body');
    });

    it('maps parse_error as malformed', async () => {
      search.mockResolvedValue({
        items: [],
        meta: {
          provider: 'brightdata',
          zone: 'mcp_unlocker',
          attempt: 1,
          httpStatus: 200,
          responseBytes: 12,
          elapsedMs: 5,
          emptyBody: false,
          parseError: 'Invalid JSON',
          query: 'brand',
          resultCategory: 'parse_error',
        },
      });

      const result = await adapter.search({ text: 'brand' });
      expect(result.outcome).toBe('parse_error');
      expect(result.providerFailureKind).toBe('malformed');
    });

    it('maps http_error', async () => {
      search.mockResolvedValue({
        items: [],
        meta: {
          provider: 'brightdata',
          attempt: 1,
          httpStatus: 504,
          responseBytes: 0,
          elapsedMs: 5,
          emptyBody: true,
          query: 'brand',
          resultCategory: 'http_error',
        },
      });

      const result = await adapter.search({ text: 'brand' });
      expect(result.outcome).toBe('http_error');
      expect(result.providerFailureKind).toBe('http');
    });

    it('maps network_error as transport', async () => {
      search.mockResolvedValue({
        items: [],
        meta: {
          provider: 'brightdata',
          attempt: 1,
          httpStatus: 0,
          responseBytes: 0,
          elapsedMs: 2,
          emptyBody: true,
          query: 'brand',
          resultCategory: 'network_error',
        },
      });

      const result = await adapter.search({ text: 'brand' });
      expect(result.outcome).toBe('network_error');
      expect(result.providerFailureKind).toBe('transport');
    });
  });
});
