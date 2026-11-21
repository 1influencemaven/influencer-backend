import type { AiExecutionRequest } from '@influence-maven/ai-contracts';

import { BrightDataToolsClient } from '../brightdata/client';
import type { InfluencerAiEnv } from '../config/env';

jest.mock('../agents/contact-research.agent', () => ({
  createContactResearchAgent: jest.fn(() => ({
    generate: jest.fn(),
  })),
}));

import { runContactResearchFindBrandEmails } from './run-find-brand-emails';

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
};

function request(): Extract<AiExecutionRequest, { type: 'CONTACT_RESEARCH' }> {
  return {
    contractVersion: '1.0',
    executionId: '11111111-1111-4111-8111-111111111111',
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'test',
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
      operation: 'FIND_BRAND_EMAILS',
      brandName: 'Acme',
      website: 'https://acme.test',
      domain: 'acme.test',
      maxSerpQueries: 2,
      maxPages: 3,
    },
  };
}

describe('runContactResearchFindBrandEmails seed path', () => {
  it('skipLlm: RESULTS_FOUND when seed extracts emails', async () => {
    const client = {
      isConfigured: () => true,
      openPage: jest.fn(async (url: string) => ({
        ok: true,
        httpStatus: 200,
        bodyLength: 40,
        elapsedMs: 1,
        html: `<a href="mailto:hello@acme.test">x</a> ${url}`,
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

    const result = await runContactResearchFindBrandEmails(baseEnv, request(), {
      client,
      skipLlm: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outcome).toBe('RESULTS_FOUND');
    expect(result.output.emails.some((e) => e.email === 'hello@acme.test')).toBe(
      true,
    );
    expect(result.output.trace?.pageCalls).toBeGreaterThan(0);
    expect(result.llmCallCount).toBe(0);
    // RF-04.3: successful pages emitted as capped snapshots (even if 2B later skipped)
    expect(result.output.pageSnapshots?.length).toBeGreaterThan(0);
    expect(result.output.pageSnapshots?.[0].content.length).toBeGreaterThan(0);
    expect(result.output.pageSnapshots?.[0].fetchedAt).toMatch(/^\d{4}-/);
    expect(result.output.pageSnapshots?.[0].mailtoEmails).toContain(
      'hello@acme.test',
    );
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

    const result = await runContactResearchFindBrandEmails(baseEnv, request(), {
      client,
      skipLlm: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outcome).toBe('NO_MATCHES');
    expect(result.output.emails).toEqual([]);
    expect(result.output.trace?.pageCalls).toBeGreaterThan(0);
  });

  it('RF-02.1: reserves page + SERP budget for LLM after seed+SERP (maxPages=5)', async () => {
    const openPage = jest.fn(async () => ({
      ok: true,
      httpStatus: 200,
      bodyLength: 20,
      elapsedMs: 1,
      html: '<html><body>no mail</body></html>',
      emptyBody: false,
    }));
    const searchWeb = jest.fn().mockResolvedValue({
      ok: true,
      organics: [
        { link: 'https://acme.test/partnerships', title: 'p', snippet: '' },
        { link: 'https://acme.test/creators', title: 'c', snippet: '' },
        { link: 'https://acme.test/press', title: 'pr', snippet: '' },
      ],
      httpStatus: 200,
      bodyLength: 2,
      elapsedMs: 1,
      emptyBody: false,
    });
    const client = {
      isConfigured: () => true,
      openPage,
      searchWeb,
    } as unknown as BrightDataToolsClient;

    const req = request();
    req.input = {
      ...req.input,
      maxSerpQueries: 5,
      maxPages: 5,
      seedUrls: ['not-a-url', 'ftp://acme.test/x', 'https://other.com/press'],
    };

    const result = await runContactResearchFindBrandEmails(baseEnv, req, {
      client,
      skipLlm: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // seed max = min(3, 5-1) = 3; SERP pages = min(2, 5-3-1) = 1 → total ≤ 4, ≥1 left for LLM
    expect(result.output.trace?.pageCalls ?? 0).toBeLessThanOrEqual(4);
    expect(5 - (result.output.trace?.pageCalls ?? 0)).toBeGreaterThanOrEqual(1);
    // SERP seed queries reserved: min(2, 5-1) = 2 max used by pre-LLM
    expect(result.output.trace?.serpCalls ?? 0).toBeLessThanOrEqual(2);
    expect(5 - (result.output.trace?.serpCalls ?? 0)).toBeGreaterThanOrEqual(1);
    // Invalid preferred URLs dropped; off-domain preferred ignored by seed allowlist
    expect(openPage.mock.calls.every(([url]) => String(url).includes('acme.test'))).toBe(
      true,
    );
  });
});
