import { BrightDataToolsClient } from '../brightdata/client';
import { ContactResearchToolSession } from '../brightdata/session';
import {
  buildSeedCandidateUrls,
  seedBrandPagesForEmailDiscovery,
} from './seed-brand-pages';

describe('buildSeedCandidateUrls', () => {
  it('includes homepage and contact paths on brand domain', () => {
    const session = new ContactResearchToolSession({
      brandName: 'Light Artsy',
      website: 'https://lightartsy.com',
      domain: 'lightartsy.com',
      maxSerpQueries: 5,
      maxPages: 5,
    });
    const urls = buildSeedCandidateUrls(session);
    expect(urls[0]).toMatch(/lightartsy\.com/i);
    expect(urls.some((u) => u.includes('/contact'))).toBe(true);
    expect(urls.every((u) => session.isAllowedUrl(u))).toBe(true);
  });

  it('rejects off-domain website', () => {
    const session = new ContactResearchToolSession({
      brandName: 'X',
      website: 'https://evil.example',
      domain: 'lightartsy.com',
      maxSerpQueries: 2,
      maxPages: 2,
    });
    expect(buildSeedCandidateUrls(session)).toEqual([]);
  });
});

describe('seedBrandPagesForEmailDiscovery', () => {
  function mockClient(
    pages: Record<string, { ok: boolean; html: string }>,
  ): BrightDataToolsClient {
    return {
      isConfigured: () => true,
      openPage: jest.fn(async (url: string) => {
        const hit = pages[url] ?? { ok: false, html: '' };
        return {
          ok: hit.ok,
          httpStatus: hit.ok ? 200 : 500,
          bodyLength: hit.html.length,
          elapsedMs: 1,
          html: hit.html,
          emptyBody: hit.html.length === 0,
        };
      }),
      searchWeb: jest.fn(),
    } as unknown as BrightDataToolsClient;
  }

  it('opens pages, extracts emails into session, counts pageCalls', async () => {
    const home = 'https://acme.test/';
    const contact = 'https://acme.test/contact';
    const session = new ContactResearchToolSession({
      brandName: 'Acme',
      website: home,
      domain: 'acme.test',
      maxSerpQueries: 3,
      maxPages: 5,
    });
    const client = mockClient({
      [home]: {
        ok: true,
        html: '<p>Reach us at hello@acme.test</p>',
      },
      [contact]: {
        ok: true,
        html: '<p>press@acme.test</p>',
      },
    });

    const seed = await seedBrandPagesForEmailDiscovery({
      client,
      session,
      maxSeedPages: 2,
    });

    expect(seed.openedUrls.length).toBe(2);
    expect(session.pageCalls).toBe(2);
    expect(session.pageHtml.size).toBe(2);
    expect(session.listEmails().map((e) => e.email).sort()).toEqual([
      'hello@acme.test',
      'press@acme.test',
    ]);
    expect(seed.emailsFound).toBe(2);
  });

  it('records failures without inventing emails', async () => {
    const home = 'https://acme.test/';
    const session = new ContactResearchToolSession({
      brandName: 'Acme',
      website: home,
      domain: 'acme.test',
      maxSerpQueries: 1,
      maxPages: 3,
    });
    const client = mockClient({
      [home]: { ok: false, html: '' },
    });

    const seed = await seedBrandPagesForEmailDiscovery({
      client,
      session,
      maxSeedPages: 1,
    });

    expect(seed.openedUrls).toEqual([]);
    expect(seed.failedUrls).toContain(home);
    expect(session.emails.size).toBe(0);
    expect(session.lastError).toBeTruthy();
  });
});
