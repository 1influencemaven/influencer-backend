import { ConfigService } from '@nestjs/config';

import { BrightDataSearchClient } from './brightdata-search.client';

function mockConfig(
  overrides: Record<string, string | number> = {},
): ConfigService {
  const values: Record<string, string | number> = {
    BRIGHTDATA_API_KEY: 'test-key',
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
});
