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
});
