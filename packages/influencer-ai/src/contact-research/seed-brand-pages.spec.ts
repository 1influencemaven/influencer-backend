import { BrightDataToolsClient } from '../brightdata/client';
import { ContactResearchToolSession } from '../brightdata/session';
import {
  buildSeedCandidateUrls,
  COMMERCIAL_SEED_PATHS,
  seedBrandPagesForEmailDiscovery,
} from './seed-brand-pages';

describe('buildSeedCandidateUrls (RF-02)', () => {
  it('prioritizes preferred URLs then commercial paths including partnerships', () => {
    const session = new ContactResearchToolSession({
      brandName: 'Light Artsy',
      website: 'https://lightartsy.com',
      domain: 'lightartsy.com',
      maxSerpQueries: 5,
      maxPages: 5,
    });
    const preferred = ['https://lightartsy.com/press'];
    const urls = buildSeedCandidateUrls(session, preferred);
    expect(urls[0]).toBe('https://lightartsy.com/press');
    expect(urls.some((u) => u.includes('/partnerships'))).toBe(true);
    expect(urls.some((u) => u.includes('/creators'))).toBe(true);
    expect(urls.some((u) => u.includes('/affiliate'))).toBe(true);
    expect(urls.some((u) => u.includes('/contact'))).toBe(true);
    expect(COMMERCIAL_SEED_PATHS.length).toBeGreaterThan(10);
    expect(urls.every((u) => session.isAllowedUrl(u))).toBe(true);
  });

  it('rejects off-domain website and preferred URLs', () => {
    const session = new ContactResearchToolSession({
      brandName: 'X',
      website: 'https://evil.example',
      domain: 'lightartsy.com',
      maxSerpQueries: 2,
      maxPages: 2,
    });
    expect(buildSeedCandidateUrls(session, ['https://evil.example/x'])).toEqual(
      [],
    );
  });

  it('dedupes preferred URL that matches a commercial path', () => {
    const session = new ContactResearchToolSession({
      brandName: 'Acme',
      website: 'https://acme.test',
      domain: 'acme.test',
      maxSerpQueries: 2,
      maxPages: 5,
    });
    const urls = buildSeedCandidateUrls(session, [
      'https://acme.test/partnerships',
      'https://acme.test/partnerships/',
    ]);
    expect(
      urls.filter((u) => u === 'https://acme.test/partnerships').length,
    ).toBe(1);
  });
});

describe('seedBrandPagesForEmailDiscovery (RF-02)', () => {
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

  it('opens preferred commercial page first and extracts partnerships@ (case 1)', async () => {
    const partnerships = 'https://acme.test/partnerships';
    const session = new ContactResearchToolSession({
      brandName: 'Acme',
      website: 'https://acme.test',
      domain: 'acme.test',
      maxSerpQueries: 3,
      maxPages: 5,
    });
    const client = mockClient({
      [partnerships]: {
        ok: true,
        html: '<p>Email partnerships@acme.test</p>',
      },
    });

    const seed = await seedBrandPagesForEmailDiscovery({
      client,
      session,
      preferredUrls: [partnerships],
      maxSeedPages: 1,
    });

    expect(seed.openedUrls).toEqual([partnerships]);
    expect(seed.preferredAttempted).toBe(1);
    expect(session.listEmails().map((e) => e.email)).toEqual([
      'partnerships@acme.test',
    ]);
  });

  it('continues after a failed page and still extracts later emails (case 15)', async () => {
    const failUrl = 'https://acme.test/partnerships';
    const contact = 'https://acme.test/contact';
    const session = new ContactResearchToolSession({
      brandName: 'Acme',
      website: 'https://acme.test',
      domain: 'acme.test',
      maxSerpQueries: 1,
      maxPages: 5,
    });
    const client = mockClient({
      [failUrl]: { ok: false, html: '' },
      [contact]: {
        ok: true,
        html: '<p>creators@acme.test</p>',
      },
    });

    // Prefer fail then ensure contact is in candidate list within maxSeedPages
    const seed = await seedBrandPagesForEmailDiscovery({
      client,
      session,
      preferredUrls: [failUrl, contact],
      maxSeedPages: 2,
    });

    expect(seed.failedUrls).toContain(failUrl);
    expect(seed.openedUrls).toContain(contact);
    expect(session.listEmails().map((e) => e.email)).toContain(
      'creators@acme.test',
    );
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
      preferredUrls: [home],
      maxSeedPages: 1,
    });

    expect(seed.openedUrls).toEqual([]);
    expect(seed.failedUrls).toContain(home);
    expect(session.emails.size).toBe(0);
    expect(session.lastError).toBeTruthy();
  });
});
