import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import { runBrandDiscoveryPlanSearch } from '../brand-discovery/run-plan-search';
import { runBrandDiscoveryScoreCandidates } from '../brand-discovery/run-score-candidates';
import { handleAiExecutionRequest } from './handle-request';

jest.mock('../brand-discovery/run-plan-search', () => ({
  runBrandDiscoveryPlanSearch: jest.fn(),
}));

jest.mock('../brand-discovery/run-score-candidates', () => ({
  runBrandDiscoveryScoreCandidates: jest.fn(),
}));

const mockPlanSearch = runBrandDiscoveryPlanSearch as jest.MockedFunction<
  typeof runBrandDiscoveryPlanSearch
>;
const mockScoreCandidates =
  runBrandDiscoveryScoreCandidates as jest.MockedFunction<
    typeof runBrandDiscoveryScoreCandidates
  >;

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

  const ibp = {
    targetSectors: ['wellness'],
    excludedSectors: ['gambling'],
    brandSize: ['smb'],
    markets: ['Spain'],
    collaborationTypes: ['UGC'],
    summary: 'Wellness brands.',
    alertSignals: [],
    desirableCriteria: ['sustainability'],
  };

  const ibpRequest = {
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
    instructions: { business: 'Produce IBP.', businessHash: 'abcdefghijklmnop' },
    input: {
      influencer: { id: 'inf-1', name: 'Ada' },
    },
  };

  const brandPlanRequest = {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: '55555555-5555-4555-8555-555555555555',
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'brand-plan:run-1:v1',
    requestedAt: new Date().toISOString(),
    type: 'BRAND_DISCOVERY' as const,
    context: {
      userId: 'user-1',
      influencerId: 'inf-9',
      resourceId: 'run-bd-1',
      resourceType: 'BRAND_DISCOVERY_RUN' as const,
    },
    instructions: { business: '', businessHash: 'planhash12345678' },
    input: {
      operation: 'PLAN_SEARCH' as const,
      influencerName: 'Ada',
      niche: 'fitness',
      maxQueries: 4,
      ibp,
    },
  };

  const brandScoreRequest = {
    ...brandPlanRequest,
    executionId: '66666666-6666-4666-8666-666666666666',
    idempotencyKey: 'brand-score:run-1:v1',
    instructions: {
      business: 'Prefer evidence-backed brands.',
      businessHash: 'scorehash1234567',
    },
    input: {
      operation: 'SCORE_CANDIDATES' as const,
      influencerName: 'Ada',
      niche: 'fitness',
      limit: 2,
      ibp,
      searchHits: [
        {
          title: 'TrailCo',
          url: 'https://trailco.example',
          content: 'Outdoor apparel',
        },
      ],
    },
  };

  beforeEach(() => {
    mockPlanSearch.mockReset();
    mockScoreCandidates.mockReset();
  });

  it('1: publishes COMPLETED IBP result and terminal event', async () => {
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
      raw: ibpRequest,
      ibpAgent: ibpAgent as never,
      brandDiscoveryAgent: { generate: jest.fn() } as never,
      env,
      resultsQueue: resultsQueue as never,
      eventsQueue: eventsQueue as never,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.type).toBe('IBP_GENERATION');
    expect(resultsQueue.add).toHaveBeenCalled();
    expect(eventsQueue.add.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mockPlanSearch).not.toHaveBeenCalled();
    expect(mockScoreCandidates).not.toHaveBeenCalled();
  });

  it('2: routes BRAND_DISCOVERY PLAN_SEARCH to plan runner', async () => {
    const planOutput = {
      operation: 'PLAN_SEARCH' as const,
      queries: ['wellness brand Spain influencer marketing'],
    };
    mockPlanSearch.mockResolvedValue({
      ok: true,
      output: planOutput,
      llmCallCount: 1,
    });

    const resultsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const eventsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const brandDiscoveryAgent = { generate: jest.fn() };

    const result = await handleAiExecutionRequest({
      raw: brandPlanRequest,
      ibpAgent: { generate: jest.fn() } as never,
      brandDiscoveryAgent: brandDiscoveryAgent as never,
      env,
      resultsQueue: resultsQueue as never,
      eventsQueue: eventsQueue as never,
    });

    expect(mockPlanSearch).toHaveBeenCalledTimes(1);
    expect(mockPlanSearch).toHaveBeenCalledWith(
      brandDiscoveryAgent,
      expect.objectContaining({
        type: 'BRAND_DISCOVERY',
        input: expect.objectContaining({ operation: 'PLAN_SEARCH' }),
      }),
    );
    expect(mockScoreCandidates).not.toHaveBeenCalled();
    expect(result.status).toBe('COMPLETED');
    expect(result.type).toBe('BRAND_DISCOVERY');
    if (result.status === 'COMPLETED' && result.type === 'BRAND_DISCOVERY') {
      expect(result.output).toEqual(planOutput);
      expect(result.metadata.llmCallCount).toBe(1);
    }
    expect(eventsQueue.add.mock.calls.length).toBe(3);
  });

  it('3: routes BRAND_DISCOVERY SCORE_CANDIDATES to score runner', async () => {
    const scoreOutput = {
      operation: 'SCORE_CANDIDATES' as const,
      brands: [
        {
          name: 'TrailCo',
          website: 'https://trailco.example',
          score: 80,
          fitReason: 'Strong outdoor fit.',
          evidenceUrls: ['https://trailco.example'],
        },
      ],
    };
    mockScoreCandidates.mockResolvedValue({
      ok: true,
      output: scoreOutput,
      llmCallCount: 2,
    });

    const resultsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const eventsQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const result = await handleAiExecutionRequest({
      raw: brandScoreRequest,
      ibpAgent: { generate: jest.fn() } as never,
      brandDiscoveryAgent: { generate: jest.fn() } as never,
      env,
      resultsQueue: resultsQueue as never,
      eventsQueue: eventsQueue as never,
    });

    expect(mockScoreCandidates).toHaveBeenCalledTimes(1);
    expect(mockPlanSearch).not.toHaveBeenCalled();
    expect(result.status).toBe('COMPLETED');
    expect(result.type).toBe('BRAND_DISCOVERY');
    if (result.status === 'COMPLETED' && result.type === 'BRAND_DISCOVERY') {
      expect(result.output).toEqual(scoreOutput);
      expect(result.metadata.llmCallCount).toBe(2);
      expect(result.metadata.promptBusinessHash).toBe('scorehash1234567');
    }
  });

  it('4: fails unsupported capabilities (LEAD_DISCOVERY)', async () => {
    const resultsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const eventsQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const leadRequest = {
      ...ibpRequest,
      type: 'LEAD_DISCOVERY' as const,
      context: {
        userId: 'user-1',
        influencerId: 'inf-1',
        resourceId: 'lead-run-1',
        resourceType: 'LEAD_DISCOVERY_RUN' as const,
      },
      input: {
        operation: 'PLAN' as const,
        brandName: 'Acme',
        website: 'https://acme.example',
        domain: 'acme.example',
        limit: 5,
        scraperAllowlist: [{ id: 's1', name: 'Scraper' }],
      },
    };

    const result = await handleAiExecutionRequest({
      raw: leadRequest,
      ibpAgent: { generate: jest.fn() } as never,
      brandDiscoveryAgent: { generate: jest.fn() } as never,
      env,
      resultsQueue: resultsQueue as never,
      eventsQueue: eventsQueue as never,
    });

    expect(result.status).toBe('FAILED');
    expect(result.type).toBe('LEAD_DISCOVERY');
    expect(result.error?.code).toBe('AI_INTERNAL_ERROR');
    expect(result.error?.message).toMatch(/not migrated/i);
    expect(mockPlanSearch).not.toHaveBeenCalled();
    expect(mockScoreCandidates).not.toHaveBeenCalled();
  });

  it('5: maps runner failure to FAILED Brand Discovery result', async () => {
    mockPlanSearch.mockResolvedValue({
      ok: false,
      code: 'AI_INVALID_OUTPUT',
      message: 'PLAN_SEARCH structured output missing after retry',
      retryable: true,
      llmCallCount: 2,
    });

    const resultsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const eventsQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const result = await handleAiExecutionRequest({
      raw: brandPlanRequest,
      ibpAgent: { generate: jest.fn() } as never,
      brandDiscoveryAgent: { generate: jest.fn() } as never,
      env,
      resultsQueue: resultsQueue as never,
      eventsQueue: eventsQueue as never,
    });

    expect(result.status).toBe('FAILED');
    expect(result.type).toBe('BRAND_DISCOVERY');
    expect(result.error?.code).toBe('AI_INVALID_OUTPUT');
    expect(result.error?.retryable).toBe(true);
    expect(result.metadata.llmCallCount).toBe(2);
    const lastEventJob = eventsQueue.add.mock.calls.at(-1)?.[1];
    expect(lastEventJob).toMatchObject({
      name: 'ai.execution.failed',
      type: 'BRAND_DISCOVERY',
    });
  });

  it('6: preserves Brand Discovery output, metadata and llmCallCount', async () => {
    mockScoreCandidates.mockResolvedValue({
      ok: true,
      output: {
        operation: 'SCORE_CANDIDATES',
        brands: [
          {
            name: 'TrailCo',
            website: 'https://trailco.example',
            score: 75,
            fitReason: 'Fit.',
            evidenceUrls: ['https://trailco.example'],
          },
        ],
      },
      llmCallCount: 1,
    });

    const resultsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const eventsQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const result = await handleAiExecutionRequest({
      raw: brandScoreRequest,
      ibpAgent: { generate: jest.fn() } as never,
      brandDiscoveryAgent: { generate: jest.fn() } as never,
      env,
      resultsQueue: resultsQueue as never,
      eventsQueue: eventsQueue as never,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.metadata).toMatchObject({
      provider: 'ollama',
      model: 'llama3.2:3b',
      llmCallCount: 1,
      promptBusinessHash: 'scorehash1234567',
    });
    const published = resultsQueue.add.mock.calls[0][1];
    expect(published).toMatchObject({
      type: 'BRAND_DISCOVERY',
      status: 'COMPLETED',
      output: {
        operation: 'SCORE_CANDIDATES',
        brands: [expect.objectContaining({ name: 'TrailCo', score: 75 })],
      },
      metadata: expect.objectContaining({ llmCallCount: 1 }),
    });
  });

  it('7: publishes accepted, started, and terminal events for Brand Discovery', async () => {
    mockPlanSearch.mockResolvedValue({
      ok: true,
      output: {
        operation: 'PLAN_SEARCH',
        queries: ['query one about brands'],
      },
      llmCallCount: 1,
    });

    const resultsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const eventsQueue = { add: jest.fn().mockResolvedValue(undefined) };

    await handleAiExecutionRequest({
      raw: brandPlanRequest,
      ibpAgent: { generate: jest.fn() } as never,
      brandDiscoveryAgent: { generate: jest.fn() } as never,
      env,
      resultsQueue: resultsQueue as never,
      eventsQueue: eventsQueue as never,
    });

    const eventNames = eventsQueue.add.mock.calls.map(
      (call) => call[1].name as string,
    );
    expect(eventNames).toEqual([
      'ai.execution.accepted',
      'ai.execution.started',
      'ai.execution.completed',
    ]);
  });
});
