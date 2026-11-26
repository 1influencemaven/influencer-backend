import type { AiExecutionRequest } from '@influence-maven/ai-contracts';

import { BrightDataToolsClient } from '../brightdata/client';
import type { InfluencerAiEnv } from '../config/env';

jest.mock('../agents/contact-research-agency-emails.agent', () => ({
  createContactResearchAgencyEmailsAgent: jest.fn(() => ({
    generate: jest.fn(),
  })),
}));

import {
  DEFAULT_LEAD_DISCOVERY_BUSINESS_INSTRUCTIONS,
  LEAD_DISCOVERY_INSTRUCTIONS_MAX_CHARS,
} from '../prompts/lead-discovery-business-instructions';
import {
  filterOnAgencyDomainSeedUrls,
  runContactResearchFindAgencyEmails,
} from './run-find-agency-emails';
import {
  classifyAgencyMailboxRelevance,
  isExcludedAgencyMailboxLocal,
} from './agency-email-classify';
import { buildAgencyCommercialSerpQueries } from './agency-seed-paths';

const baseEnv: InfluencerAiEnv = {
  redisHost: '127.0.0.1',
  redisPort: 6379,
  redisDb: 0,
  aiProvider: 'ollama',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b',
  anthropicApiKey: undefined,
  anthropicModel: 'claude-sonnet-4-20250514',
  brightDataApiKey: 'k',
  brightDataSerpZone: 'serp_api',
  brightDataUnlockerZone: 'mcp_unlocker',
  brightDataTimeoutMs: 60000,
  brightDataLinkedInPeopleDatasetId: 'gd_test',
  brightDataScraperPollTimeoutMs: 120000,
  brightDataScraperPollIntervalMs: 3000,
};

function request(
  overrides?: Partial<
    Extract<AiExecutionRequest, { type: 'CONTACT_RESEARCH' }>['input']
  >,
): Extract<AiExecutionRequest, { type: 'CONTACT_RESEARCH' }> {
  return {
    contractVersion: '1.0',
    executionId: '11111111-1111-4111-8111-111111111111',
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'agency-emails:test',
    requestedAt: new Date().toISOString(),
    type: 'CONTACT_RESEARCH',
    context: {
      userId: 'u',
      influencerId: '00000000-0000-4000-8000-000000000099',
      resourceId: '00000000-0000-4000-8000-000000000098',
      resourceType: 'CONTACT_RESEARCH_RUN',
    },
    instructions: { business: '', businessHash: '0'.repeat(16) },
    input: {
      operation: 'FIND_AGENCY_EMAILS',
      agencyId: 'agency-1',
      agencyName: 'Creator Partners',
      website: 'https://creatorpartners.test',
      domain: 'creatorpartners.test',
      maxSerpQueries: 2,
      maxPages: 3,
      ...overrides,
    },
  };
}

describe('runContactResearchFindAgencyEmails (2C.4.4)', () => {
  it('rejects wrong operation', async () => {
    const bad = request();
    (bad as { input: { operation: string } }).input.operation =
      'FIND_BRAND_EMAILS';
    const result = await runContactResearchFindAgencyEmails(baseEnv, bad, {
      client: { isConfigured: () => true } as never,
      skipLlm: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AI_INTERNAL_ERROR');
  });

  it('PROVIDER_FAILURE when Bright Data not configured', async () => {
    const result = await runContactResearchFindAgencyEmails(baseEnv, request(), {
      client: { isConfigured: () => false } as never,
      skipLlm: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AI_PROVIDER_ERROR');
  });

  it('skipLlm: RESULTS_FOUND with classification + UNVERIFIED provenance', async () => {
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async (url: string) => ({
        ok: true,
        httpStatus: 200,
        bodyLength: 80,
        elapsedMs: 1,
        html: `<a href="mailto:partnerships@creatorpartners.test">x</a>
               <a href="mailto:noreply@creatorpartners.test">n</a>
               <a href="mailto:support@creatorpartners.test">s</a> ${url}`,
        emptyBody: false,
      })),
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      request(),
      { client, skipLlm: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.operation).toBe('FIND_AGENCY_EMAILS');
    expect(result.output.outcome).toBe('RESULTS_FOUND');
    expect(
      result.output.emails.some(
        (e) => e.email === 'partnerships@creatorpartners.test',
      ),
    ).toBe(true);
    expect(
      result.output.emails.some((e) => e.email.startsWith('noreply@')),
    ).toBe(false);
    expect(
      result.output.emails.some((e) => e.email.startsWith('support@')),
    ).toBe(false);
    const hit = result.output.emails.find(
      (e) => e.email === 'partnerships@creatorpartners.test',
    );
    expect(hit?.commercialRelevance).toBe('HIGH');
    expect(hit?.isGeneric).toBe(true);
    expect(hit?.outreachRole).toBe('Partnerships');
    expect(hit?.sourceKind).toBe('agency_web');
    expect(hit?.provenance?.verificationStatus).toBe('UNVERIFIED');
    expect(hit?.provenance?.discoveryStatus).toBe('FOUND');
    expect(hit?.provenance?.attributionStatus).toBe('ATTRIBUTED');
    expect(result.output.pageSnapshots?.length).toBeGreaterThan(0);
    expect(result.llmCallCount).toBe(0);
  });

  it('explicitly emits sourceKind agency_web on every mailbox (not Zod-only default)', async () => {
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async () => ({
        ok: true,
        httpStatus: 200,
        bodyLength: 80,
        elapsedMs: 1,
        html: `<a href="mailto:creators@creatorpartners.test">c</a>
               <a href="mailto:hello@creatorpartners.test">h</a>`,
        emptyBody: false,
      })),
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      request(),
      { client, skipLlm: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.emails.length).toBeGreaterThanOrEqual(2);
    for (const email of result.output.emails) {
      expect(email).toEqual(
        expect.objectContaining({ sourceKind: 'agency_web' }),
      );
      // Own property on parsed output — runner mapped it before contract parse.
      expect(
        Object.prototype.hasOwnProperty.call(email, 'sourceKind'),
      ).toBe(true);
    }
  });

  it('skipLlm: NO_MATCHES when pages open but no emails', async () => {
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async () => ({
        ok: true,
        httpStatus: 200,
        bodyLength: 20,
        elapsedMs: 1,
        html: '<html><body>no mail</body></html>',
        emptyBody: false,
      })),
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      request(),
      { client, skipLlm: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outcome).toBe('NO_MATCHES');
    expect(result.output.emails).toEqual([]);
  });

  it('skipLlm: PROVIDER_FAILURE when seed cannot open pages', async () => {
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async () => ({
        ok: false,
        httpStatus: 500,
        bodyLength: 0,
        elapsedMs: 1,
        html: '',
        emptyBody: true,
        brdError: 'unlocker_down',
      })),
      searchWeb: jest.fn().mockResolvedValue({
        ok: false,
        organics: [],
        httpStatus: 500,
        bodyLength: 0,
        elapsedMs: 1,
        emptyBody: true,
        brdError: 'serp_down',
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      request(),
      { client, skipLlm: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outcome).toBe('PROVIDER_FAILURE');
  });

  it('filters off-domain seedUrls; keeps on-domain', () => {
    const kept = filterOnAgencyDomainSeedUrls(
      [
        'https://creatorpartners.test/contact',
        'https://nike.com/press',
        'https://mail.creatorpartners.test/team',
      ],
      'creatorpartners.test',
    );
    expect(kept).toEqual([
      'https://creatorpartners.test/contact',
      'https://mail.creatorpartners.test/team',
    ]);
  });

  it('processes on-domain seedUrls via openPage', async () => {
    const openPage = jest.fn(async (url: string) => ({
      ok: true,
      httpStatus: 200,
      bodyLength: 40,
      elapsedMs: 1,
      html: `<a href="mailto:collab@creatorpartners.test">x</a> ${url}`,
      emptyBody: false,
    }));
    const client = {
      isConfigured: () => true,
      openPage,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      request({
        seedUrls: [
          'https://creatorpartners.test/partnerships',
          'https://evil.example/contact',
        ],
        maxPages: 2,
      }),
      { client, skipLlm: true },
    );

    expect(result.ok).toBe(true);
    const opened = openPage.mock.calls.map((c) => c[0] as string);
    expect(opened.some((u) => u.includes('evil.example'))).toBe(false);
    expect(
      opened.some((u) => u.includes('creatorpartners.test')),
    ).toBe(true);
  });

  it('does not attribute person names (mailbox-only output shape)', async () => {
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async () => ({
        ok: true,
        httpStatus: 200,
        bodyLength: 40,
        elapsedMs: 1,
        html: '<a href="mailto:alex@creatorpartners.test">Alex</a>',
        emptyBody: false,
      })),
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      request(),
      { client, skipLlm: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.emails[0]).not.toHaveProperty('displayName');
    expect(result.output.emails[0]).not.toHaveProperty('name');
    expect(result.output.emails[0]?.isGeneric).toBe(false);
    expect(result.output.emails[0]?.sourceKind).toBe('agency_web');
    expect(result.output.emails[0]?.provenance?.verificationStatus).toBe(
      'UNVERIFIED',
    );
  });

  it('drops off-domain emails even if present in HTML', async () => {
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async () => ({
        ok: true,
        httpStatus: 200,
        bodyLength: 80,
        elapsedMs: 1,
        html: `<a href="mailto:press@creatorpartners.test">ok</a>
               <a href="mailto:hello@other-agency.test">no</a>`,
        emptyBody: false,
      })),
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      request(),
      { client, skipLlm: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.output.emails.map((e) => e.email),
    ).toEqual(['press@creatorpartners.test']);
  });

  it('SERP seed uses site:agencyDomain queries', async () => {
    const searchWeb = jest.fn().mockResolvedValue({
      ok: true,
      organics: [
        {
          link: 'https://creatorpartners.test/talent',
          title: 'talent',
          snippet: '',
        },
      ],
      httpStatus: 200,
      bodyLength: 2,
      elapsedMs: 1,
      emptyBody: false,
    });
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async (url: string) => ({
        ok: true,
        httpStatus: 200,
        bodyLength: 20,
        elapsedMs: 1,
        html: `<html><body>no mail ${url}</body></html>`,
        emptyBody: false,
      })),
      searchWeb,
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      request({ maxSerpQueries: 5, maxPages: 5 }),
      { client, skipLlm: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(searchWeb.mock.calls.length).toBeGreaterThan(0);
    const queries = searchWeb.mock.calls.map((c) => String(c[0]));
    expect(queries.every((q) => q.includes('site:creatorpartners.test'))).toBe(
      true,
    );
    expect(result.output.trace?.queries?.length).toBeGreaterThan(0);
  });

  it('RF-04: pageSnapshots capped and include fetchedAt', async () => {
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async (url: string) => ({
        ok: true,
        httpStatus: 200,
        bodyLength: 40,
        elapsedMs: 1,
        html: `<a href="mailto:info@creatorpartners.test">x</a> ${url}`,
        emptyBody: false,
      })),
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      request({ maxPages: 8 }),
      { client, skipLlm: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.output.pageSnapshots?.length ?? 0) <= 4).toBe(true);
    for (const snap of result.output.pageSnapshots ?? []) {
      expect(snap.content.length).toBeLessThanOrEqual(20_000);
      expect(snap.fetchedAt).toMatch(/^\d{4}-/);
      expect(snap.url).toContain('creatorpartners.test');
    }
  });

  it('rejects FIND_BRAND_EMAILS-shaped input as wrong operation (isolation)', async () => {
    const brandReq = request();
    (brandReq as { input: { operation: string } }).input.operation =
      'FIND_BRAND_PEOPLE';
    const result = await runContactResearchFindAgencyEmails(
      baseEnv,
      brandReq,
      {
        client: { isConfigured: () => true } as never,
        skipLlm: true,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/FIND_BRAND_PEOPLE/);
  });

  it('passes request.instructions.business into agency LLM prompt, defaults when empty, and truncates oversized text', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: { outcome: 'NO_MATCHES', summary: 'none', emails: [] },
    });
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async () => ({
        ok: true,
        httpStatus: 200,
        bodyLength: 20,
        elapsedMs: 1,
        html: '<html><body>no mail</body></html>',
        emptyBody: false,
      })),
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const customReq = request();
    customReq.instructions = {
      business: 'Prioritize LATAM influencer agency campaign desks.',
      businessHash: 'a'.repeat(16),
    };
    const r1 = await runContactResearchFindAgencyEmails(baseEnv, customReq, {
      client,
      createAgent: () => ({ generate }) as never,
    });
    expect(r1.ok).toBe(true);
    expect(String(generate.mock.calls[0][0])).toContain(
      'Prioritize LATAM influencer agency campaign desks.',
    );
    expect(String(generate.mock.calls[0][0])).toContain(
      'RF-01: Never invent emails or people',
    );

    await runContactResearchFindAgencyEmails(baseEnv, request(), {
      client,
      createAgent: () => ({ generate }) as never,
    });
    expect(String(generate.mock.calls[1][0])).toContain(
      DEFAULT_LEAD_DISCOVERY_BUSINESS_INSTRUCTIONS,
    );

    const longReq = request();
    longReq.instructions = {
      business: `AGENCY_START_${'Y'.repeat(LEAD_DISCOVERY_INSTRUCTIONS_MAX_CHARS + 500)}_AGENCY_END`,
      businessHash: 'b'.repeat(16),
    };
    await runContactResearchFindAgencyEmails(baseEnv, longReq, {
      client,
      createAgent: () => ({ generate }) as never,
    });
    const longPrompt = String(generate.mock.calls[2][0]);
    expect(longPrompt).toContain('AGENCY_START_');
    expect(longPrompt).not.toContain('AGENCY_END');
    expect(longPrompt).toContain('[...truncated]');
  });
});

describe('agency email helpers', () => {
  it('classifies and excludes locals', () => {
    expect(classifyAgencyMailboxRelevance('talent@x.test')).toBe('HIGH');
    expect(classifyAgencyMailboxRelevance('marketing@x.test')).toBe('NEUTRAL');
    expect(classifyAgencyMailboxRelevance('info@x.test')).toBe('UNKNOWN');
    expect(isExcludedAgencyMailboxLocal('noreply@x.test')).toBe(true);
    expect(isExcludedAgencyMailboxLocal('support@x.test')).toBe(true);
  });

  it('builds site: agency SERP queries', () => {
    const q = buildAgencyCommercialSerpQueries({
      agencyName: 'Glow Agency',
      domain: 'glow.test',
      niche: 'beauty',
      maxQueries: 2,
    });
    expect(q).toHaveLength(2);
    expect(q.every((x) => x.includes('site:glow.test'))).toBe(true);
  });
});
