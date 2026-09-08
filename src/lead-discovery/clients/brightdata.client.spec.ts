import { ConfigService } from '@nestjs/config';

import { BrightDataClient } from './brightdata.client';

const SCRAPER_ID = 'gd_l1viktl72bvl7bjuj0';
const SNAPSHOT_ID = 'sd_test_snapshot_001';

function mockConfig(
  overrides: Record<string, string | number> = {},
): ConfigService {
  const values: Record<string, string | number> = {
    BRIGHTDATA_API_KEY: 'test-key',
    BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 120000,
    BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 3000,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function progressResponse(status: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ status, snapshot_id: SNAPSHOT_ID }),
  };
}

function triggerWithSnapshot() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ snapshot_id: SNAPSHOT_ID }),
  };
}

function snapshotDownload(records: unknown[]) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(records),
  };
}

describe('BrightDataClient snapshot polling', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('polls starting → running → ready then downloads snapshot', async () => {
    fetchMock
      .mockResolvedValueOnce(triggerWithSnapshot())
      .mockResolvedValueOnce(progressResponse('starting'))
      .mockResolvedValueOnce(progressResponse('running'))
      .mockResolvedValueOnce(progressResponse('ready'))
      .mockResolvedValueOnce(
        snapshotDownload([{ name: 'Alice', url: 'https://linkedin.com/in/alice' }]),
      );

    const client = new BrightDataClient(
      mockConfig({
        BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 1,
        BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 5000,
      }),
    );

    const records = await client.triggerAndCollect(SCRAPER_ID, [
      { url: 'https://www.linkedin.com/in/alice' },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('Alice');

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/trigger');
    expect(urls[1]).toContain(`/progress/${SNAPSHOT_ID}`);
    expect(urls[2]).toContain(`/progress/${SNAPSHOT_ID}`);
    expect(urls[3]).toContain(`/progress/${SNAPSHOT_ID}`);
    expect(urls[4]).toContain(`/snapshot/${SNAPSHOT_ID}`);
    expect(urls.filter((u) => u.includes('/snapshot/')).length).toBe(1);
  });

  it('polls running until ready after several attempts', async () => {
    fetchMock.mockResolvedValueOnce(triggerWithSnapshot());
    for (let i = 0; i < 4; i += 1) {
      fetchMock.mockResolvedValueOnce(progressResponse('running'));
    }
    fetchMock.mockResolvedValueOnce(progressResponse('ready'));
    fetchMock.mockResolvedValueOnce(snapshotDownload([{ name: 'Bob' }]));

    const client = new BrightDataClient(
      mockConfig({
        BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 1,
        BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 5000,
      }),
    );

    const records = await client.triggerAndCollect(SCRAPER_ID, [
      { url: 'https://www.linkedin.com/in/bob' },
    ]);
    expect(records[0].name).toBe('Bob');
    expect(
      fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes('/progress/'),
      ).length,
    ).toBe(5);
  });

  it('throws when progress reports failed', async () => {
    fetchMock
      .mockResolvedValueOnce(triggerWithSnapshot())
      .mockResolvedValueOnce(progressResponse('failed'));

    const client = new BrightDataClient(
      mockConfig({
        BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 1,
        BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 5000,
      }),
    );

    await expect(
      client.triggerAndCollect(SCRAPER_ID, [
        { url: 'https://www.linkedin.com/in/x' },
      ]),
    ).rejects.toThrow('BrightData snapshot failed');
  });

  it('throws when progress reports canceled', async () => {
    fetchMock
      .mockResolvedValueOnce(triggerWithSnapshot())
      .mockResolvedValueOnce(progressResponse('canceled'));

    const client = new BrightDataClient(
      mockConfig({
        BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 1,
        BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 5000,
      }),
    );

    await expect(
      client.triggerAndCollect(SCRAPER_ID, [
        { url: 'https://www.linkedin.com/in/x' },
      ]),
    ).rejects.toThrow('BrightData snapshot canceled');
  });

  it('times out when progress stays running', async () => {
    fetchMock.mockResolvedValueOnce(triggerWithSnapshot());
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/progress/')) {
        return progressResponse('running');
      }
      return triggerWithSnapshot();
    });

    const client = new BrightDataClient(
      mockConfig({
        BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 10,
        BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 50,
      }),
    );

    await expect(
      client.triggerAndCollect(SCRAPER_ID, [
        { url: 'https://www.linkedin.com/in/x' },
      ]),
    ).rejects.toThrow('BrightData snapshot polling timed out');

    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('/snapshot/')),
    ).toBe(false);
  });

  it('throws on HTTP error when consulting progress', async () => {
    fetchMock
      .mockResolvedValueOnce(triggerWithSnapshot())
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
      });

    const client = new BrightDataClient(
      mockConfig({
        BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 1,
        BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 5000,
      }),
    );

    await expect(
      client.triggerAndCollect(SCRAPER_ID, [
        { url: 'https://www.linkedin.com/in/x' },
      ]),
    ).rejects.toThrow('BrightData progress request failed: 503');
  });

  it('uses custom poll timeout from config', async () => {
    fetchMock.mockResolvedValueOnce(triggerWithSnapshot());
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/progress/')) {
        return progressResponse('running');
      }
      return triggerWithSnapshot();
    });

    const client = new BrightDataClient(
      mockConfig({
        BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 5,
        BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 30,
      }),
    );

    const start = Date.now();
    await expect(
      client.triggerAndCollect(SCRAPER_ID, [{ url: 'https://linkedin.com/in/y' }]),
    ).rejects.toThrow('timed out');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(200);
  });

  it('uses custom poll interval from config', async () => {
    fetchMock
      .mockResolvedValueOnce(triggerWithSnapshot())
      .mockResolvedValueOnce(progressResponse('running'))
      .mockResolvedValueOnce(progressResponse('ready'))
      .mockResolvedValueOnce(snapshotDownload([{ name: 'Carol' }]));

    const client = new BrightDataClient(
      mockConfig({
        BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 40,
        BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 5000,
      }),
    );

    const start = Date.now();
    await client.triggerAndCollect(SCRAPER_ID, [
      { url: 'https://www.linkedin.com/in/carol' },
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(35);
  });

  it('throws when snapshot download fails after ready', async () => {
    fetchMock
      .mockResolvedValueOnce(triggerWithSnapshot())
      .mockResolvedValueOnce(progressResponse('ready'))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'download error',
      });

    const client = new BrightDataClient(
      mockConfig({
        BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS: 1,
        BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS: 5000,
      }),
    );

    await expect(
      client.triggerAndCollect(SCRAPER_ID, [
        { url: 'https://www.linkedin.com/in/z' },
      ]),
    ).rejects.toThrow('BrightData snapshot download failed: 500');
  });
});
