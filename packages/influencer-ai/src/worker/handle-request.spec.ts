import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import { handleAiExecutionRequest } from './handle-request';

describe('handleAiExecutionRequest', () => {
  const env = {
    redisHost: '127.0.0.1',
    redisPort: 6379,
    redisDb: 0,
    aiProvider: 'ollama' as const,
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'llama3.2:3b',
    anthropicModel: 'claude-sonnet-4-20250514',
  };

  const request = {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: '11111111-1111-4111-8111-111111111111',
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'ibp:test:2',
    requestedAt: new Date().toISOString(),
    type: 'IBP_GENERATION' as const,
    context: {
      userId: 'user-1',
      influencerId: 'inf-1',
      resourceId: 'inf-1',
      resourceType: 'IDEAL_BRAND_PROFILE' as const,
    },
    instructions: { business: 'Produce IBP.' },
    input: {
      influencer: { id: 'inf-1', name: 'Ada' },
    },
  };

  it('publishes COMPLETED result and terminal event', async () => {
    const output = {
      targetSectors: ['tech'],
      excludedSectors: [],
      brandSize: ['smb'],
      markets: ['Spain'],
      collaborationTypes: ['UGC'],
      summary: 'Tech SMB brands.',
      alertSignals: [],
      desirableCriteria: [],
    };

    const resultsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const eventsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const ibpAgent = {
      generate: jest.fn().mockResolvedValue({ object: output }),
    };

    const result = await handleAiExecutionRequest({
      raw: request,
      ibpAgent: ibpAgent as never,
      env,
      resultsQueue: resultsQueue as never,
      eventsQueue: eventsQueue as never,
    });

    expect(result.status).toBe('COMPLETED');
    expect(resultsQueue.add).toHaveBeenCalled();
    expect(eventsQueue.add.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects non-IBP capabilities in AI-003.2', async () => {
    const resultsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const eventsQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const brandRequest = {
      ...request,
      type: 'BRAND_DISCOVERY',
      input: {
        operation: 'PLAN_SEARCH',
        influencerName: 'Ada',
        maxQueries: 4,
        ibp: {
          targetSectors: ['a'],
          excludedSectors: [],
          brandSize: ['smb'],
          markets: ['Spain'],
          collaborationTypes: ['UGC'],
          summary: 'x',
          alertSignals: [],
          desirableCriteria: [],
        },
      },
    };

    const result = await handleAiExecutionRequest({
      raw: brandRequest,
      ibpAgent: { generate: jest.fn() } as never,
      env,
      resultsQueue: resultsQueue as never,
      eventsQueue: eventsQueue as never,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.message).toMatch(/not migrated/i);
  });
});
