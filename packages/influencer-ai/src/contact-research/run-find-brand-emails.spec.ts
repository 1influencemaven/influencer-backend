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
      searchWeb: jest.fn(),
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
      searchWeb: jest.fn(),
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
});
