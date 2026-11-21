import { BrightDataToolsClient } from '../brightdata/client';
import { ContactResearchToolSession } from '../brightdata/session';
import {
  buildCommercialSerpQueries,
  seedCommercialSerpPages,
} from './commercial-serp-seed';

describe('buildCommercialSerpQueries (RF-02)', () => {
  it('builds site: queries for brand domain', () => {
    const queries = buildCommercialSerpQueries({
      brandName: 'Acme Co',
      domain: 'acme.test',
      niche: 'home',
      maxQueries: 2,
    });
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.includes('site:acme.test'))).toBe(true);
    expect(queries[0]).toMatch(/partnerships|creators|influencer/i);
  });
});

describe('seedCommercialSerpPages (RF-02)', () => {
  it('opens on-domain SERP hits and extracts emails without reopening seeded pages', async () => {
    const session = new ContactResearchToolSession({
      brandName: 'Acme',
      website: 'https://acme.test',
      domain: 'acme.test',
      maxSerpQueries: 5,
      maxPages: 5,
    });
    session.pages.push('https://acme.test/contact');
    session.pageCalls = 1;

    const client = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          {
            title: 'Partnerships',
            url: 'https://acme.test/partnerships',
            snippet: 'collab',
          },
          {
            title: 'Contact',
            url: 'https://acme.test/contact',
            snippet: 'already seeded',
          },
          {
            title: 'Off domain',
            url: 'https://other.test/x',
            snippet: 'nope',
          },
        ],
      }),
      openPage: jest.fn().mockResolvedValue({
        ok: true,
        html: '<p>creators@acme.test and marketing@acme.test</p>',
        httpStatus: 200,
        bodyLength: 40,
        elapsedMs: 1,
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const result = await seedCommercialSerpPages({
      client,
      session,
      brandName: 'Acme',
      domain: 'acme.test',
      maxQueries: 1,
      maxPages: 1,
    });

    expect(result.serpCalls).toBe(1);
    expect(result.openedUrls).toEqual(['https://acme.test/partnerships']);
    expect(client.openPage).toHaveBeenCalledTimes(1);
    expect(session.pageOriginCounts.duplicateUrlSkips).toBeGreaterThanOrEqual(1);
    expect(session.pageOriginCounts.serpSeedPagesAttempted).toBe(1);
    expect(session.pageOriginCounts.serpSeedPagesDownloaded).toBe(1);
    expect(session.listEmails().map((e) => e.email).sort()).toEqual([
      'creators@acme.test',
      'marketing@acme.test',
    ]);
  });
});
