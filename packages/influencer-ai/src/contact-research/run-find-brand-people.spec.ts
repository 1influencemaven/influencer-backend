import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import type { BrightDataToolsClient } from '../brightdata/client';
import { runContactResearchFindBrandPeople } from './run-find-brand-people';

describe('runContactResearchFindBrandPeople', () => {
  const env = {
    redisHost: '127.0.0.1',
    redisPort: 6379,
    redisDb: 0,
    aiProvider: 'ollama' as const,
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'llama3.2:3b',
    anthropicModel: 'claude-sonnet-4-20250514',
    brightDataApiKey: 'key',
    brightDataSerpZone: 'serp_api',
    brightDataUnlockerZone: 'mcp_unlocker',
    brightDataTimeoutMs: 5000,
    brightDataLinkedInPeopleDatasetId: 'gd_l1viktl72bvl7bjuj0',
    brightDataScraperPollTimeoutMs: 10000,
    brightDataScraperPollIntervalMs: 100,
  };

  const baseRequest = {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: '44444444-4444-4444-8444-444444444444',
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'people:1',
    requestedAt: new Date().toISOString(),
    type: 'CONTACT_RESEARCH' as const,
    context: {
      userId: 'u1',
      influencerId: '33333333-3333-4333-8333-333333333333',
      resourceId: '55555555-5555-4555-8555-555555555555',
      resourceType: 'CONTACT_RESEARCH_RUN' as const,
    },
    instructions: { business: '', businessHash: 'abcdefghijklmnop' },
    input: {
      operation: 'FIND_BRAND_PEOPLE' as const,
      brandName: 'Demo Co',
      website: 'https://demo.co',
      domain: 'demo.co',
      maxSerpQueries: 2,
      maxProfilesToScrape: 2,
      maxBrandPages: 2,
      ocrEnabled: false,
    },
  };

  it('returns RESULTS_FOUND with people and brand_web email via PEE', async () => {
    const client = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          {
            title: 'Alex Partner - Demo Co',
            url: 'https://www.linkedin.com/in/alex-partner',
            snippet: 'Influencer Marketing',
          },
        ],
      }),
      scrapeLinkedInProfile: jest.fn().mockResolvedValue({
        ok: true,
        url: 'https://www.linkedin.com/in/alex-partner',
        name: 'Alex Partner',
        title: 'Influencer Marketing Manager',
        about: 'Building creator programs',
        emailFields: [],
      }),
      openPage: jest.fn().mockResolvedValue({
        ok: true,
        html: '<html><body>Contact Alex at alex@demo.co for partnerships</body></html>',
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindBrandPeople(env, baseRequest, {
      client,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.operation).toBe('FIND_BRAND_PEOPLE');
    expect(result.output.outcome).toBe('RESULTS_FOUND');
    expect(result.output.people).toHaveLength(1);
    expect(result.output.people[0].name).toBe('Alex Partner');
    expect(result.output.people[0].emails[0]?.email).toBe('alex@demo.co');
    expect(result.output.people[0].emails[0]?.sourceKind).toBe('brand_web');
    expect(result.output.trace?.profilesScraped).toBe(1);
  });

  it('RF-01.1: LinkedIn about generic stays on payload for Nest BBC (not silently dropped)', async () => {
    const client = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          {
            title: 'Alex Partner - Demo Co',
            url: 'https://www.linkedin.com/in/alex-partner',
            snippet: 'Influencer Marketing',
          },
        ],
      }),
      scrapeLinkedInProfile: jest.fn().mockResolvedValue({
        ok: true,
        url: 'https://www.linkedin.com/in/alex-partner',
        name: 'Alex Partner',
        title: 'Influencer Marketing Manager',
        about: 'Email the brand at info@demo.co',
        emailFields: ['alex@demo.co'],
      }),
      openPage: jest.fn().mockResolvedValue({ ok: true, html: '<html></html>' }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindBrandPeople(env, baseRequest, {
      client,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const emails = result.output.people[0].emails.map((e) => e.email);
    // Personal LinkedIn field preserved; generic also present for Nest reclassification.
    expect(emails).toContain('alex@demo.co');
    expect(emails).toContain('info@demo.co');
  });

  it('RF-01: does not assign generic brand inbox to first LinkedIn without name match', async () => {
    const client = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          {
            title: 'Alex Partner - Demo Co',
            url: 'https://www.linkedin.com/in/alex-partner',
            snippet: 'Influencer Marketing',
          },
        ],
      }),
      scrapeLinkedInProfile: jest.fn().mockResolvedValue({
        ok: true,
        url: 'https://www.linkedin.com/in/alex-partner',
        name: 'Alex Partner',
        title: 'Influencer Marketing Manager',
        about: 'Building creator programs',
        emailFields: [],
      }),
      openPage: jest.fn().mockResolvedValue({
        ok: true,
        html: '<html><body>Email us at info@demo.co</body></html>',
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindBrandPeople(env, baseRequest, {
      client,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.people).toHaveLength(1);
    expect(result.output.people[0].emails).toEqual([]);
  });

  it('returns NO_MATCHES when SERP has no LinkedIn people', async () => {
    const client = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          { title: 'Home', url: 'https://demo.co', snippet: 'brand site' },
        ],
      }),
      scrapeLinkedInProfile: jest.fn(),
      openPage: jest.fn(),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindBrandPeople(env, baseRequest, {
      client,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outcome).toBe('NO_MATCHES');
    expect(result.output.people).toEqual([]);
    expect(client.scrapeLinkedInProfile).not.toHaveBeenCalled();
  });

  describe('RF-04.3 page snapshot PEE reuse', () => {
    const linkedInClientBase = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          {
            title: 'Alex Partner - Demo Co',
            url: 'https://www.linkedin.com/in/alex-partner',
            snippet: 'Influencer Marketing',
          },
        ],
      }),
      scrapeLinkedInProfile: jest.fn().mockResolvedValue({
        ok: true,
        url: 'https://www.linkedin.com/in/alex-partner',
        name: 'Alex Partner',
        title: 'Influencer Marketing Manager',
        about: 'Building creator programs',
        emailFields: [],
      }),
    };

    it('reuses valid 2A snapshot for PEE without Unlocker', async () => {
      const openPage = jest.fn();
      const client = {
        ...linkedInClientBase,
        openPage,
      } as unknown as BrightDataToolsClient;

      const request = {
        ...baseRequest,
        input: {
          ...baseRequest.input,
          maxBrandPages: 2,
          pageSnapshots: [
            {
              url: 'https://demo.co/',
              normalizedUrl: 'https://demo.co/',
              fetchedAt: '2026-03-01T10:00:00.000Z',
              content:
                '<html><body>Contact Alex at alex@demo.co for partnerships</body></html>',
              truncated: false,
            },
            {
              url: 'https://demo.co/contact',
              normalizedUrl: 'https://demo.co/contact',
              fetchedAt: '2026-03-01T10:01:00.000Z',
              content: '<html><body>team page</body></html>',
              truncated: false,
            },
          ],
        },
      };

      const result = await runContactResearchFindBrandPeople(env, request, {
        client,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(openPage).not.toHaveBeenCalled();
      expect(result.output.trace?.brandPagesFetched).toBe(0);
      expect(result.output.trace?.peeReuse).toEqual({
        snapshotsReceivedFrom2A: 2,
        peePagesReused: 2,
        peePagesFetchedUnlocker: 0,
        peePagesRejected: 0,
        unlockerCallsAvoided: 2,
      });
      expect(result.output.people[0].emails[0]?.email).toBe('alex@demo.co');
      expect(result.output.people[0].emails[0]?.sourceKind).toBe('brand_web');
      expect(result.output.people[0].emails[0]?.sourceUrl).toBe(
        'https://demo.co/',
      );
    });

    it('falls back to Unlocker for empty/invalid snapshot content', async () => {
      const openPage = jest.fn().mockResolvedValue({
        ok: true,
        html: '<html><body>Contact Alex at alex@demo.co</body></html>',
      });
      const client = {
        ...linkedInClientBase,
        openPage,
      } as unknown as BrightDataToolsClient;

      const request = {
        ...baseRequest,
        input: {
          ...baseRequest.input,
          maxBrandPages: 1,
          pageSnapshots: [
            {
              url: 'https://demo.co/',
              normalizedUrl: 'https://demo.co/',
              fetchedAt: '2026-03-01T10:00:00.000Z',
              content: 'x',
              truncated: false,
            },
          ],
        },
      };
      // Force empty via cast after schema-less runner path: replace with rejected empty
      request.input.pageSnapshots = [
        {
          url: 'https://demo.co/',
          normalizedUrl: 'https://demo.co/',
          fetchedAt: '2026-03-01T10:00:00.000Z',
          content: '',
          truncated: true,
        } as never,
      ];

      const result = await runContactResearchFindBrandPeople(env, request, {
        client,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(openPage).toHaveBeenCalled();
      expect(result.output.trace?.peeReuse?.peePagesRejected).toBe(1);
      expect(result.output.trace?.peeReuse?.peePagesFetchedUnlocker).toBe(1);
      expect(result.output.trace?.peeReuse?.peePagesReused).toBe(0);
    });

    it('rejects off-domain snapshot and Unlocker-fetches PEE candidates', async () => {
      const openPage = jest.fn().mockResolvedValue({
        ok: true,
        html: '<html></html>',
      });
      const client = {
        ...linkedInClientBase,
        openPage,
      } as unknown as BrightDataToolsClient;

      const request = {
        ...baseRequest,
        input: {
          ...baseRequest.input,
          maxBrandPages: 2,
          pageSnapshots: [
            {
              url: 'https://other.test/contact',
              normalizedUrl: 'https://other.test/contact',
              fetchedAt: '2026-03-01T10:00:00.000Z',
              content: '<html>Alex alex@other.test</html>',
              truncated: false,
            },
          ],
        },
      };

      const result = await runContactResearchFindBrandPeople(env, request, {
        client,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(openPage).toHaveBeenCalled();
      expect(result.output.trace?.peeReuse?.peePagesRejected).toBe(1);
      expect(result.output.trace?.peeReuse?.peePagesReused).toBe(0);
    });

    it('does not Unlocker-refetch when truncated snapshot yields no email', async () => {
      const openPage = jest.fn();
      const client = {
        ...linkedInClientBase,
        openPage,
      } as unknown as BrightDataToolsClient;

      const request = {
        ...baseRequest,
        input: {
          ...baseRequest.input,
          maxBrandPages: 1,
          pageSnapshots: [
            {
              url: 'https://demo.co/',
              normalizedUrl: 'https://demo.co/',
              fetchedAt: '2026-03-01T10:00:00.000Z',
              content: '<html><body>no emails here</body></html>',
              truncated: true,
            },
          ],
        },
      };

      const result = await runContactResearchFindBrandPeople(env, request, {
        client,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(openPage).not.toHaveBeenCalled();
      expect(result.output.trace?.peeReuse?.peePagesReused).toBe(1);
      expect(result.output.trace?.peeReuse?.unlockerCallsAvoided).toBe(1);
      expect(result.output.people[0].emails).toEqual([]);
    });

    it('preserves mailtoEmails when content truncated away', async () => {
      const openPage = jest.fn();
      const client = {
        ...linkedInClientBase,
        openPage,
      } as unknown as BrightDataToolsClient;

      const request = {
        ...baseRequest,
        input: {
          ...baseRequest.input,
          maxBrandPages: 1,
          pageSnapshots: [
            {
              url: 'https://demo.co/',
              normalizedUrl: 'https://demo.co/',
              fetchedAt: '2026-03-01T10:00:00.000Z',
              // Name near end so reinjected mailto + Alex share evidence window
              content:
                '<html><body>' +
                'x'.repeat(80) +
                ' Reach Alex for deals</body></html>',
              truncated: true,
              mailtoEmails: ['alex@demo.co'],
            },
          ],
        },
      };

      const result = await runContactResearchFindBrandPeople(env, request, {
        client,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(openPage).not.toHaveBeenCalled();
      expect(result.output.people[0].emails[0]?.email).toBe('alex@demo.co');
      expect(result.output.people[0].emails[0]?.sourceKind).toBe('brand_web');
    });

    it('absence of snapshots keeps prior Unlocker behavior', async () => {
      const openPage = jest.fn().mockResolvedValue({
        ok: true,
        html: '<html><body>Contact Alex at alex@demo.co</body></html>',
      });
      const client = {
        ...linkedInClientBase,
        openPage,
      } as unknown as BrightDataToolsClient;

      const result = await runContactResearchFindBrandPeople(env, baseRequest, {
        client,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(openPage).toHaveBeenCalled();
      expect(result.output.trace?.peeReuse).toBeUndefined();
      expect(result.output.trace?.brandPagesFetched).toBeGreaterThan(0);
    });

    it('RF-04.3.1 M1: mismatched normalizedUrl rejected → Unlocker fallback', async () => {
      const openPage = jest.fn().mockResolvedValue({
        ok: true,
        html: '<html><body>Contact Alex at alex@demo.co</body></html>',
      });
      const client = {
        ...linkedInClientBase,
        openPage,
      } as unknown as BrightDataToolsClient;

      const request = {
        ...baseRequest,
        input: {
          ...baseRequest.input,
          maxBrandPages: 1,
          pageSnapshots: [
            {
              // Content from /pricing but claims homepage PEE key
              url: 'https://demo.co/pricing',
              normalizedUrl: 'https://demo.co/',
              fetchedAt: '2026-03-01T10:00:00.000Z',
              content:
                '<html><body>Hijack Alex at alex@demo.co</body></html>',
              truncated: false,
            },
          ],
        },
      };

      const result = await runContactResearchFindBrandPeople(env, request, {
        client,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.output.trace?.peeReuse?.peePagesRejected).toBe(1);
      expect(result.output.trace?.peeReuse?.peePagesReused).toBe(0);
      expect(openPage).toHaveBeenCalled();
      expect(result.output.trace?.peeReuse?.peePagesFetchedUnlocker).toBe(1);
    });

    it('RF-04.3.1 L4: reinjected generic mailtoEmails are not attributed to person', async () => {
      const openPage = jest.fn();
      const client = {
        ...linkedInClientBase,
        openPage,
      } as unknown as BrightDataToolsClient;

      const generics = ['info@demo.co', 'hello@demo.co', 'contact@demo.co'];
      const request = {
        ...baseRequest,
        input: {
          ...baseRequest.input,
          maxBrandPages: 1,
          pageSnapshots: [
            {
              url: 'https://demo.co/',
              normalizedUrl: 'https://demo.co/',
              fetchedAt: '2026-03-01T10:00:00.000Z',
              // Name present so a naive matcher could wrongly attribute
              content:
                '<html><body>Reach Alex Partner for partnerships</body></html>',
              truncated: true,
              mailtoEmails: generics,
            },
          ],
        },
      };

      const result = await runContactResearchFindBrandPeople(env, request, {
        client,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(openPage).not.toHaveBeenCalled();
      expect(result.output.trace?.peeReuse?.peePagesReused).toBe(1);
      // RF-01: generics never land on the person (same gate as HTML-extracted)
      expect(result.output.people[0].emails).toEqual([]);
      for (const g of generics) {
        expect(
          result.output.people[0].emails.some((e) => e.email === g),
        ).toBe(false);
      }
      // Runner does not mint VERIFIED — person has no email channels to verify
      expect(
        result.output.people[0].emails.every(
          (e) => (e as { verificationStatus?: string }).verificationStatus !== 'VERIFIED',
        ),
      ).toBe(true);
    });
  });
});
