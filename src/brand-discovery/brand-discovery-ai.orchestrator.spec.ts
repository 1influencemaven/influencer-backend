/* eslint-disable @typescript-eslint/no-unsafe-assignment */
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import {
  AI_EXECUTION_WAIT_ERROR_CODES,
  AiExecutionWaitError,
} from '../ai-execution/ai-execution-result-wait.errors';
import {
  BrandDiscoveryAiOrchestrator,
  BRAND_DISCOVERY_PLAN_TIMEOUT_MS,
  BRAND_DISCOVERY_SCORE_TIMEOUT_MS,
  BRAND_DISCOVERY_SERP_MAX_RESULTS_PER_QUERY,
} from './brand-discovery-ai.orchestrator';
import {
  BRAND_DISCOVERY_AI_ERROR_CODES,
  BrandDiscoveryAiOrchestratorError,
} from './brand-discovery-ai.orchestrator.errors';

const PLAN_EXECUTION_ID = '55555555-5555-4555-8555-555555555555';
const SCORE_EXECUTION_ID = '66666666-6666-4666-8666-666666666666';
const CORRELATION_ID = '22222222-2222-4222-8222-222222222222';

const ibp = {
  targetSectors: ['wellness', 'sportswear'],
  excludedSectors: ['gambling'],
  brandSize: ['smb'],
  markets: ['Spain'],
  collaborationTypes: ['brand ambassador'],
  summary: 'Marcas wellness',
  alertSignals: ['miracle claims'],
  desirableCriteria: ['sustainability'],
};

const baseParams = {
  runId: 'run-bd-1',
  userId: 'user-1',
  influencerId: 'inf-1',
  influencerName: 'Ada',
  niche: 'fitness',
  ibp,
  limit: 10,
  promptInstructions: 'Prefiere evidencia oficial',
};

function planCompleted(queries: string[]) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: PLAN_EXECUTION_ID,
    correlationId: CORRELATION_ID,
    type: 'BRAND_DISCOVERY' as const,
    status: 'COMPLETED' as const,
    startedAt: '2026-10-30T20:02:01.000Z',
    finishedAt: '2026-10-30T20:02:04.000Z',
    durationMs: 3000,
    metadata: { provider: 'ollama', model: 'llama3.2:3b', llmCallCount: 1 },
    output: { operation: 'PLAN_SEARCH' as const, queries },
  };
}

function planFailed(code: string, message: string) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: PLAN_EXECUTION_ID,
    correlationId: CORRELATION_ID,
    type: 'BRAND_DISCOVERY' as const,
    status: 'FAILED' as const,
    startedAt: '2026-10-30T20:02:01.000Z',
    finishedAt: '2026-10-30T20:02:04.000Z',
    durationMs: 3000,
    metadata: { provider: 'ollama', model: 'llama3.2:3b', llmCallCount: 1 },
    error: {
      code,
      message,
      retryable: false,
      occurredAt: '2026-10-30T20:02:04.000Z',
    },
  };
}

function scoreCompleted(
  brands: Array<{
    name: string;
    website: string;
    score: number;
    fitReason: string;
    evidenceUrls: string[];
  }>,
) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: SCORE_EXECUTION_ID,
    correlationId: CORRELATION_ID,
    type: 'BRAND_DISCOVERY' as const,
    status: 'COMPLETED' as const,
    startedAt: '2026-10-30T20:03:01.000Z',
    finishedAt: '2026-10-30T20:03:10.000Z',
    durationMs: 9000,
    metadata: { provider: 'ollama', model: 'llama3.2:3b', llmCallCount: 1 },
    output: { operation: 'SCORE_CANDIDATES' as const, brands },
  };
}

function scoreFailed(code: string, message: string) {
  return {
    ...scoreCompleted([]),
    status: 'FAILED' as const,
    output: undefined,
    error: {
      code,
      message,
      retryable: true,
      occurredAt: '2026-10-30T20:03:10.000Z',
    },
  };
}

describe('BrandDiscoveryAiOrchestrator', () => {
  function build(opts?: {
    publishPlan?: jest.Mock;
    publishScore?: jest.Mock;
    wait?: jest.Mock;
    search?: jest.Mock;
    getInstructions?: jest.Mock;
    getConfig?: (key: string) => unknown;
  }) {
    const publishPlan =
      opts?.publishPlan ??
      jest.fn().mockResolvedValue({
        executionId: PLAN_EXECUTION_ID,
        correlationId: CORRELATION_ID,
      });
    const publishScore =
      opts?.publishScore ??
      jest.fn().mockResolvedValue({
        executionId: SCORE_EXECUTION_ID,
        correlationId: CORRELATION_ID,
      });
    const wait = opts?.wait ?? jest.fn();
    const defaultHit = {
      title: 'Demo Wellness',
      url: 'https://demo.example',
      content: 'fitness apparel',
    };
    const toDiagnosticsResult = (value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'hits' in value &&
        'diagnostic' in value
      ) {
        return value;
      }
      const hits = Array.isArray(value) ? value : [];
      return {
        hits,
        diagnostic: {
          query: 'q',
          resultCategory:
            hits.length > 0
              ? ('organic_results' as const)
              : ('organic_empty' as const),
          httpStatus: 200,
          responseBytes: 100,
          latencyMs: 10,
          attempts: 1,
          organicResultsCount: hits.length,
        },
      };
    };
    const search = opts?.search ?? jest.fn().mockResolvedValue([defaultHit]);
    const searchWithDiagnostics = jest
      .fn()
      .mockImplementation(async (...args: unknown[]) => {
        const raw = await search(...args);
        return toDiagnosticsResult(raw);
      });
    const getInstructions =
      opts?.getInstructions ??
      jest.fn().mockResolvedValue('default instructions');
    const getConfig =
      opts?.getConfig ??
      ((key: string) => {
        if (key === 'BRAND_SEARCH_STRATEGY') return 'llm';
        if (key === 'BRAND_DISCOVERY_GEO_LENSES') return 'legacy';
        if (key === 'BRAND_DISCOVERY_MIN_QUERIES') return 0;
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      });

    const orchestrator = new BrandDiscoveryAiOrchestrator(
      {
        publishBrandDiscoveryPlan: publishPlan,
        publishBrandDiscoveryScore: publishScore,
      } as never,
      { waitForAiExecutionResult: wait } as never,
      { search, searchWithDiagnostics } as never,
      { getBrandDiscoveryInstructions: getInstructions } as never,
      { get: getConfig } as never,
    );

    return {
      orchestrator,
      publishPlan,
      publishScore,
      wait,
      search,
      searchWithDiagnostics,
      getInstructions,
    };
  }

  const validQueries = [
    'wellness sportswear brand Spain influencer marketing',
    'sustainable fitness apparel brand Spain sponsorship',
  ];

  const scoredBrand = {
    name: 'Demo Wellness',
    website: 'https://demo.example',
    score: 82,
    fitReason: 'Strong IBP fit',
    evidenceUrls: ['https://demo.example'],
  };

  it('runs PLAN_SEARCH → SERP → SCORE_CANDIDATES successfully', async () => {
    const { orchestrator, publishPlan, publishScore, wait, searchWithDiagnostics } =
      build({
        wait: jest
          .fn()
          .mockResolvedValueOnce(planCompleted(validQueries))
          .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
      });

    const result = await orchestrator.orchestrate(baseParams);

    expect(publishPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-bd-1',
        maxQueries: 4,
        influencerName: 'Ada',
        promptInstructions: 'Prefiere evidencia oficial',
      }),
    );
    expect(wait).toHaveBeenNthCalledWith(
      1,
      PLAN_EXECUTION_ID,
      BRAND_DISCOVERY_PLAN_TIMEOUT_MS,
    );
    expect(searchWithDiagnostics).toHaveBeenCalledWith(validQueries[0], {
      maxResults: BRAND_DISCOVERY_SERP_MAX_RESULTS_PER_QUERY,
      geo: expect.objectContaining({
        gl: expect.any(String),
        hl: expect.any(String),
      }),
    });
    expect(publishScore).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-bd-1',
        limit: 10,
        promptInstructions: 'Prefiere evidencia oficial',
        searchHits: expect.arrayContaining([
          expect.objectContaining({
            title: 'Demo Wellness',
            url: 'https://demo.example',
          }),
        ]),
      }),
    );
    expect(wait).toHaveBeenNthCalledWith(
      2,
      SCORE_EXECUTION_ID,
      BRAND_DISCOVERY_SCORE_TIMEOUT_MS,
    );
    expect(result.brands).toEqual([scoredBrand]);
    expect(result.planExecutionId).toBe(PLAN_EXECUTION_ID);
    expect(result.scoreExecutionId).toBe(SCORE_EXECUTION_ID);
    expect(result.planExecutionId).not.toBe(result.scoreExecutionId);
    // Two SERP calls return the same demo domain; filter dedupes by host.
    expect(result.searchHitsCount).toBe(1);
    expect(result.serpHitFilter.receivedCount).toBeGreaterThanOrEqual(1);
    expect(result.serpHitFilter.keptCount).toBe(1);
    expect(result.fallbackUsed).toBe(false);
    expect(result.strategy).toBe('llm');
    expect(result.geoLensesMode).toBe('legacy');
  });

  it('v1 geo lenses: US query uses gl=us and expands configured LATAM countries', async () => {
    const search = jest.fn().mockResolvedValue([
      {
        title: 'SHEIN US',
        url: 'https://shein.com/',
        content: 'fashion available in United States',
      },
    ]);
    const { orchestrator, searchWithDiagnostics } = build({
      search,
      getConfig: (key: string) => {
        if (key === 'BRAND_SEARCH_STRATEGY') return 'llm';
        if (key === 'BRAND_DISCOVERY_GEO_LENSES') return 'v1';
        if (key === 'BRAND_DISCOVERY_MAX_SERP_CALLS') return 12;
        if (key === 'BRAND_DISCOVERY_REGION_LATAM_COUNTRIES') return 'co,mx';
        if (key === 'BRAND_DISCOVERY_MIN_QUERIES') return 0;
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      },
      wait: jest
        .fn()
        .mockResolvedValueOnce(
          planCompleted([
            'maternity apparel brands United States',
            'coaching companies LATAM',
          ]),
        )
        .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
    });

    const result = await orchestrator.orchestrate({
      ...baseParams,
      country: null,
      language: null,
      ibp: {
        ...ibp,
        targetSectors: [...ibp.targetSectors, 'maternity'],
        markets: ['LATAM', 'United States'],
      },
    });

    expect(result.geoLensesMode).toBe('v1');
    expect(result.serpLenses?.some((l) => l.gl === 'us')).toBe(true);
    expect(result.serpLenses?.map((l) => l.gl).sort()).toEqual(['co', 'mx', 'us']);
    expect(result.serpCallsExecuted).toBeLessThanOrEqual(12);
    expect(result.unresolvedSerpRegions ?? []).toEqual([]);

    const usCalls = searchWithDiagnostics.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('United States') &&
        (call[1] as { geo?: { gl?: string } })?.geo?.gl === 'us',
    );
    expect(usCalls.length).toBeGreaterThanOrEqual(1);

    const usOnMx = searchWithDiagnostics.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('United States') &&
        (call[1] as { geo?: { gl?: string } })?.geo?.gl === 'mx',
    );
    expect(usOnMx.length).toBe(0);

    expect(result.hitGeoAttribution?.some((h) => h.domain.includes('shein'))).toBe(
      true,
    );
  });

  it('propagates PLAN_SEARCH FAILED with worker code (no silent fallback)', async () => {
    const { orchestrator, publishScore, search } = build({
      wait: jest
        .fn()
        .mockResolvedValue(planFailed('AI_PROVIDER_ERROR', 'LLM down')),
    });

    await expect(orchestrator.orchestrate(baseParams)).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      message: 'LLM down',
      executionId: PLAN_EXECUTION_ID,
    });
    expect(search).not.toHaveBeenCalled();
    expect(publishScore).not.toHaveBeenCalled();
  });

  it('uses BRAND_DISCOVERY_PLAN_TIMEOUT_MS for the plan publish and wait', async () => {
    const publishPlan = jest.fn().mockResolvedValue({
      executionId: PLAN_EXECUTION_ID,
      correlationId: CORRELATION_ID,
    });
    const wait = jest
      .fn()
      .mockResolvedValueOnce(planCompleted(validQueries))
      .mockResolvedValue(scoreCompleted([scoredBrand]));
    const { orchestrator } = build({
      publishPlan,
      wait,
      getConfig: (key: string) => {
        if (key === 'BRAND_SEARCH_STRATEGY') return 'llm';
        if (key === 'BRAND_DISCOVERY_GEO_LENSES') return 'legacy';
        if (key === 'BRAND_DISCOVERY_MIN_QUERIES') return 0;
        if (key === 'BRAND_DISCOVERY_PLAN_TIMEOUT_MS') return 300_000;
        return undefined;
      },
    });

    await orchestrator.orchestrate(baseParams);

    expect(publishPlan).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 300_000 }),
    );
    expect(wait).toHaveBeenNthCalledWith(1, PLAN_EXECUTION_ID, 300_000);
  });

  it('propagates PLAN_SEARCH timeout without template fallback', async () => {
    const { orchestrator, publishScore } = build({
      wait: jest
        .fn()
        .mockRejectedValue(
          new AiExecutionWaitError(
            AI_EXECUTION_WAIT_ERROR_CODES.TIMEOUT,
            'timed out',
            PLAN_EXECUTION_ID,
          ),
        ),
    });

    await expect(orchestrator.orchestrate(baseParams)).rejects.toMatchObject({
      code: AI_EXECUTION_WAIT_ERROR_CODES.TIMEOUT,
      executionId: PLAN_EXECUTION_ID,
    });
    expect(publishScore).not.toHaveBeenCalled();
  });

  it('falls back to templates on PLAN_SEARCH AI_INVALID_OUTPUT', async () => {
    const { orchestrator, publishScore, wait, search } = build({
      wait: jest
        .fn()
        .mockResolvedValueOnce(
          planFailed('AI_INVALID_OUTPUT', 'schema mismatch'),
        )
        .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
    });

    const result = await orchestrator.orchestrate(baseParams);

    expect(result.fallbackUsed).toBe(true);
    expect(result.strategy).toBe('llm');
    expect(result.planExecutionId).toBe(PLAN_EXECUTION_ID);
    expect(result.queries.length).toBeGreaterThan(0);
    expect(result.queries.length).toBeLessThanOrEqual(4);
    expect(search).toHaveBeenCalled();
    expect(publishScore).toHaveBeenCalled();
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('validates and caps PLAN queries; empty validation triggers templates', async () => {
    const { orchestrator, search } = build({
      wait: jest
        .fn()
        .mockResolvedValueOnce(
          planCompleted([
            'best brands',
            'x',
            'gambling wellness brand Spain influencer marketing',
          ]),
        )
        .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
    });

    const result = await orchestrator.orchestrate(baseParams);

    expect(result.fallbackUsed).toBe(true);
    expect(result.plannedQueriesCount).toBe(3);
    expect(
      result.queries.every((q) => !q.toLowerCase().includes('best brands')),
    ).toBe(true);
    expect(search.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('runs SERP with max 6 results per query', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([
        { title: 'A', url: 'https://a.example', content: 'a' },
      ]);
    const { orchestrator, searchWithDiagnostics } = build({
      search,
      wait: jest
        .fn()
        .mockResolvedValueOnce(planCompleted(validQueries))
        .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
    });

    await orchestrator.orchestrate(baseParams);

    expect(searchWithDiagnostics).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        maxResults: BRAND_DISCOVERY_SERP_MAX_RESULTS_PER_QUERY,
      }),
    );
  });

  it('exposes serpDiagnostics per query on soft zero-hit SERP', async () => {
    const { orchestrator, searchWithDiagnostics } = build({
      search: jest.fn().mockResolvedValue([]),
      wait: jest
        .fn()
        .mockResolvedValueOnce(planCompleted(validQueries))
        .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
    });

    const result = await orchestrator.orchestrate(baseParams);

    expect(searchWithDiagnostics).toHaveBeenCalled();
    // Primary empty + simplified retry may collapse into fewer diagnostic rows.
    expect(result.serpDiagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.serpDiagnostics[0]).toEqual(
      expect.objectContaining({
        organicResultsCount: 0,
      }),
    );
    expect(result.serpQueryFallbackUsed).toBe(true);
  });

  it('runs SCORE_CANDIDATES with empty searchHits when SERP returns no usable hits', async () => {
    const emptyScoreBrand = {
      name: 'Knowledge Brand',
      website: 'https://knowledge.example',
      score: 70,
      fitReason: 'IBP sector fit without SERP evidence',
      evidenceUrls: [] as string[],
    };
    const { orchestrator, publishScore, wait } = build({
      search: jest.fn().mockResolvedValue([]),
      wait: jest
        .fn()
        .mockResolvedValueOnce(planCompleted(validQueries))
        .mockResolvedValueOnce(scoreCompleted([emptyScoreBrand])),
    });

    const result = await orchestrator.orchestrate(baseParams);

    expect(publishScore).toHaveBeenCalledTimes(1);
    expect(publishScore).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-bd-1',
        searchHits: [],
        promptInstructions: 'Prefiere evidencia oficial',
      }),
    );
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenNthCalledWith(
      2,
      SCORE_EXECUTION_ID,
      BRAND_DISCOVERY_SCORE_TIMEOUT_MS,
    );
    expect(result.searchHitsCount).toBe(0);
    expect(result.scoreExecutionId).toBe(SCORE_EXECUTION_ID);
    expect(result.brands).toEqual([emptyScoreBrand]);
  });

  it('does not publish SCORE when Bright Data SERP throws a hard error', async () => {
    const { orchestrator, publishScore, wait } = build({
      search: jest
        .fn()
        .mockRejectedValue(new Error('Bright Data SERP failed (http_error)')),
      wait: jest.fn().mockResolvedValueOnce(planCompleted(validQueries)),
    });

    await expect(orchestrator.orchestrate(baseParams)).rejects.toThrow(
      /Bright Data SERP failed/,
    );
    expect(publishScore).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('propagates SCORE failure after empty SERP', async () => {
    const { orchestrator } = build({
      search: jest.fn().mockResolvedValue([]),
      wait: jest
        .fn()
        .mockResolvedValueOnce(planCompleted(validQueries))
        .mockResolvedValueOnce(
          scoreFailed('AI_PROVIDER_ERROR', 'score llm down'),
        ),
    });

    await expect(orchestrator.orchestrate(baseParams)).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      executionId: SCORE_EXECUTION_ID,
    });
  });

  it('returns SCORE_CANDIDATES brands on success', async () => {
    const { orchestrator } = build({
      wait: jest
        .fn()
        .mockResolvedValueOnce(planCompleted(validQueries))
        .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
    });

    const result = await orchestrator.orchestrate(baseParams);
    expect(result.brands[0].name).toBe('Demo Wellness');
    expect(result.scoreExecutionId).toBe(SCORE_EXECUTION_ID);
  });

  it('propagates SCORE_CANDIDATES FAILED with worker code', async () => {
    const { orchestrator } = build({
      wait: jest
        .fn()
        .mockResolvedValueOnce(planCompleted(validQueries))
        .mockResolvedValueOnce(
          scoreFailed('AI_PROVIDER_ERROR', 'score llm down'),
        ),
    });

    await expect(orchestrator.orchestrate(baseParams)).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      message: 'score llm down',
      executionId: SCORE_EXECUTION_ID,
    });
  });

  it('propagates SCORE_CANDIDATES timeout', async () => {
    const { orchestrator } = build({
      wait: jest
        .fn()
        .mockResolvedValueOnce(planCompleted(validQueries))
        .mockRejectedValueOnce(
          new AiExecutionWaitError(
            AI_EXECUTION_WAIT_ERROR_CODES.TIMEOUT,
            'score timed out',
            SCORE_EXECUTION_ID,
          ),
        ),
    });

    await expect(orchestrator.orchestrate(baseParams)).rejects.toMatchObject({
      code: AI_EXECUTION_WAIT_ERROR_CODES.TIMEOUT,
      executionId: SCORE_EXECUTION_ID,
    });
  });

  it('rejects PLAN result with incorrect operation', async () => {
    const { orchestrator } = build({
      wait: jest.fn().mockResolvedValueOnce({
        ...planCompleted(validQueries),
        output: { operation: 'SCORE_CANDIDATES', brands: [] },
      }),
    });

    await expect(orchestrator.orchestrate(baseParams)).rejects.toMatchObject({
      code: BRAND_DISCOVERY_AI_ERROR_CODES.PLAN_INVALID_OPERATION,
    });
  });

  it('maps infrastructure wait errors', async () => {
    const { orchestrator } = build({
      wait: jest
        .fn()
        .mockRejectedValue(
          new AiExecutionWaitError(
            AI_EXECUTION_WAIT_ERROR_CODES.INFRASTRUCTURE,
            'ECONNREFUSED Redis',
            PLAN_EXECUTION_ID,
          ),
        ),
    });

    try {
      await orchestrator.orchestrate(baseParams);
      fail('expected infrastructure error');
    } catch (error) {
      expect(error).toBeInstanceOf(BrandDiscoveryAiOrchestratorError);
      expect((error as BrandDiscoveryAiOrchestratorError).code).toBe(
        AI_EXECUTION_WAIT_ERROR_CODES.INFRASTRUCTURE,
      );
    }
  });

  it('uses distinct executionIds for PLAN and SCORE', async () => {
    const { orchestrator, publishPlan, publishScore } = build({
      wait: jest
        .fn()
        .mockResolvedValueOnce(planCompleted(validQueries))
        .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
    });

    const result = await orchestrator.orchestrate(baseParams);

    expect(publishPlan).toHaveBeenCalledTimes(1);
    expect(publishScore).toHaveBeenCalledTimes(1);
    expect(result.planExecutionId).toBe(PLAN_EXECUTION_ID);
    expect(result.scoreExecutionId).toBe(SCORE_EXECUTION_ID);
    expect(result.planExecutionId).not.toBe(result.scoreExecutionId);
  });

  it('loads Settings instructions when promptInstructions omitted', async () => {
    const { orchestrator, publishPlan, publishScore, getInstructions } = build({
      wait: jest
        .fn()
        .mockResolvedValueOnce(planCompleted(validQueries))
        .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
    });

    await orchestrator.orchestrate({
      ...baseParams,
      promptInstructions: undefined,
    });

    expect(getInstructions).toHaveBeenCalled();
    expect(publishPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        promptInstructions: 'default instructions',
      }),
    );
    expect(publishScore).toHaveBeenCalledWith(
      expect.objectContaining({
        promptInstructions: 'default instructions',
      }),
    );
  });
  describe('creator program pass (plan_v3 2A)', () => {
    const programConfig = (extra: Record<string, unknown> = {}) => (key: string) => {
      if (key === 'BRAND_SEARCH_STRATEGY') return 'llm';
      if (key === 'BRAND_DISCOVERY_GEO_LENSES') return 'legacy';
      if (key === 'BRAND_DISCOVERY_MIN_QUERIES') return 0;
      if (key === 'NODE_ENV') return 'test';
      return extra[key];
    };
    const programHit = {
      title: 'Creator Program | Glow Labs',
      url: 'https://glowlabs.example/pages/creators',
      content: 'Apply to our creator program',
    };
    const regularHit = {
      title: 'Demo Wellness',
      url: 'https://demo.example',
      content: 'fitness apparel',
    };
    const search = jest.fn(async (query: string) =>
      query.includes('creator program') ? [programHit] : [regularHit],
    );

    it('puts program hits first, reports program domains, sends seeds only in batch 1', async () => {
      const publishScore = jest.fn().mockResolvedValue({
        executionId: SCORE_EXECUTION_ID,
        correlationId: CORRELATION_ID,
      });
      const { orchestrator, searchWithDiagnostics } = build({
        search,
        publishScore,
        getConfig: programConfig({ BRAND_DISCOVERY_SCORE_BATCH_SIZE: 1 }),
        wait: jest
          .fn()
          .mockResolvedValueOnce(planCompleted(validQueries))
          .mockResolvedValue(scoreCompleted([scoredBrand])),
      });
      const seed = { name: 'Known Co', website: 'https://known.example' };

      const result = await orchestrator.orchestrate({
        ...baseParams,
        ibp: { ...ibp, targetSectors: ['skincare', 'beauty'] },
        seedBrands: [seed],
      });

      expect(result.creatorProgramQueries).toHaveLength(2);
      expect(result.creatorProgramDomains).toEqual(['glowlabs.example']);
      expect(result.searchHits[0].url).toBe(programHit.url);
      expect(searchWithDiagnostics).toHaveBeenCalledTimes(validQueries.length + 2);
      const seedsPerBatch = publishScore.mock.calls.map(
        ([arg]) => (arg as { seedBrands?: unknown[] }).seedBrands,
      );
      expect(seedsPerBatch[0]).toEqual([seed]);
      expect(seedsPerBatch.slice(1).every((s) => s === undefined)).toBe(true);
      expect(seedsPerBatch.length).toBeGreaterThan(1);
    });

    it('is disabled with BRAND_DISCOVERY_PROGRAM_QUERIES=0', async () => {
      const { orchestrator, searchWithDiagnostics } = build({
        search,
        getConfig: programConfig({ BRAND_DISCOVERY_PROGRAM_QUERIES: 0 }),
        wait: jest
          .fn()
          .mockResolvedValueOnce(planCompleted(validQueries))
          .mockResolvedValue(scoreCompleted([scoredBrand])),
      });
      const result = await orchestrator.orchestrate({ ...baseParams });
      expect(result.creatorProgramQueries).toBeUndefined();
      expect(searchWithDiagnostics).toHaveBeenCalledTimes(validQueries.length);
    });
  });

  describe('query top-up from the IBP taxonomy', () => {
    const topUpConfig = (extra: Record<string, unknown> = {}) => (key: string) => {
      if (key === 'BRAND_SEARCH_STRATEGY') return 'llm';
      if (key === 'BRAND_DISCOVERY_GEO_LENSES') return 'legacy';
      if (key === 'NODE_ENV') return 'test';
      return extra[key];
    };

    it('tops up a heavily discarded plan with concrete subcategory queries', async () => {
      const { orchestrator, searchWithDiagnostics } = build({
        getConfig: topUpConfig(),
        wait: jest
          .fn()
          .mockResolvedValueOnce(planCompleted(['skincare brands selling in US']))
          .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
      });

      const result = await orchestrator.orchestrate({
        ...baseParams,
        ibp: { ...ibp, targetSectors: ['beauty', 'fashion', 'home decor'], markets: ['US'] },
      });

      // 1 LLM query kept + expanded queries, capped at the default 8.
      expect(result.queries.length).toBeGreaterThanOrEqual(6);
      expect(result.queries.length).toBeLessThanOrEqual(8);
      expect(result.queries[0]).toBe('skincare brands selling in US');
      // Planned queries + plan_v3 2A creator-program calls (default 2).
      expect(searchWithDiagnostics).toHaveBeenCalledTimes(
        result.queries.length + (result.creatorProgramQueries?.length ?? 0),
      );
      expect(result.creatorProgramQueries).toHaveLength(2);
      expect(result.fallbackUsed).toBe(true);
      expect(result.validatedQueriesCount).toBe(result.queries.length);
      // Expanded queries span sectors, not only the first one.
      const joined = result.queries.join(' | ');
      expect(joined).toMatch(/womens clothing|activewear|swimwear|jewelry/);
      expect(joined).toMatch(/candles|wall art|bedding/);
      expect(joined).toContain('United States');
    });

    it('does nothing when the plan already has enough queries', async () => {
      const { orchestrator } = build({
        getConfig: topUpConfig({ BRAND_DISCOVERY_MIN_QUERIES: 2 }),
        wait: jest
          .fn()
          .mockResolvedValueOnce(planCompleted(validQueries))
          .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
      });

      const result = await orchestrator.orchestrate(baseParams);

      expect(result.queries).toEqual(validQueries);
      expect(result.fallbackUsed).toBe(false);
    });

    it('can be disabled with BRAND_DISCOVERY_MIN_QUERIES=0', async () => {
      const { orchestrator } = build({
        getConfig: topUpConfig({ BRAND_DISCOVERY_MIN_QUERIES: 0 }),
        wait: jest
          .fn()
          .mockResolvedValueOnce(planCompleted(['skincare brands selling in US']))
          .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
      });

      const result = await orchestrator.orchestrate({
        ...baseParams,
        ibp: { ...ibp, targetSectors: ['beauty'], markets: ['US'] },
      });

      expect(result.queries).toEqual(['skincare brands selling in US']);
    });

    it('respects the excluded sectors when expanding', async () => {
      const { orchestrator } = build({
        getConfig: topUpConfig(),
        wait: jest
          .fn()
          .mockResolvedValueOnce(planCompleted(['skincare brands selling in US']))
          .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
      });

      const result = await orchestrator.orchestrate({
        ...baseParams,
        ibp: {
          ...ibp,
          targetSectors: ['beauty', 'fashion'],
          excludedSectors: ['swimwear', 'lingerie'],
          markets: ['US'],
        },
      });

      expect(result.queries.join(' ')).not.toMatch(/swimwear|lingerie/);
    });

    it('bounds the hits sent to SCORE and uses the configurable SCORE timeout', async () => {
      const hits = Array.from({ length: 40 }, (_, i) => ({
        title: 'Brand ' + i,
        url: 'https://brand' + i + '.example/',
        content: 'brand ' + i,
      }));
      const { orchestrator, publishScore, wait } = build({
        search: jest.fn().mockResolvedValue(hits),
        getConfig: topUpConfig({
          BRAND_DISCOVERY_MIN_QUERIES: 0,
          BRAND_DISCOVERY_MAX_SCORE_HITS: 12,
          BRAND_DISCOVERY_SCORE_BATCH_SIZE: 12,
          BRAND_DISCOVERY_SCORE_TIMEOUT_MS: 900000,
        }),
        wait: jest
          .fn()
          .mockResolvedValueOnce(planCompleted(validQueries))
          .mockResolvedValueOnce(scoreCompleted([scoredBrand])),
      });

      const result = await orchestrator.orchestrate(baseParams);

      const published = publishScore.mock.calls[0][0] as { searchHits: unknown[] };
      expect(published.searchHits).toHaveLength(12);
      // Diagnostics keep the full filtered list.
      expect(result.searchHitsCount).toBeGreaterThan(12);
      expect(wait).toHaveBeenNthCalledWith(2, SCORE_EXECUTION_ID, 900000);
    });

    describe('SCORE batching', () => {
      const makeHits = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          title: 'Brand ' + i,
          url: 'https://brand' + i + '.example/',
          content: 'brand ' + i,
        }));
      const brand = (domain: string, score: number) => ({
        name: domain,
        website: 'https://' + domain + '/',
        score,
        fitReason: 'fit',
        evidenceUrls: ['https://' + domain + '/about'],
      });
      const batchConfig = () =>
        topUpConfig({
          BRAND_DISCOVERY_MIN_QUERIES: 0,
          BRAND_DISCOVERY_MAX_SCORE_HITS: 12,
          BRAND_DISCOVERY_SCORE_BATCH_SIZE: 5,
        });

      it('splits hits into batches and merges brands by domain (higher score wins)', async () => {
        const { orchestrator, publishScore } = build({
          search: jest.fn().mockResolvedValue(makeHits(40)),
          getConfig: batchConfig(),
          wait: jest
            .fn()
            .mockResolvedValueOnce(planCompleted(validQueries))
            .mockResolvedValueOnce(scoreCompleted([brand('a.example', 50)]))
            .mockResolvedValueOnce(
              scoreCompleted([brand('a.example', 90), brand('b.example', 70)]),
            )
            .mockResolvedValueOnce(scoreCompleted([])),
        });

        const result = await orchestrator.orchestrate(baseParams);

        const sizes = publishScore.mock.calls.map(
          (call) => (call[0] as { searchHits: unknown[] }).searchHits.length,
        );
        expect(sizes).toEqual([5, 5, 2]);
        expect(result.brands).toHaveLength(2);
        expect(result.brands.find((b) => b.website.includes('a.example'))?.score).toBe(90);
        expect(result.scoreBatches).toEqual({ total: 3, failed: 0, hitsPerBatch: 5 });
      });

      it('keeps the run alive when one batch fails', async () => {
        const { orchestrator } = build({
          search: jest.fn().mockResolvedValue(makeHits(40)),
          getConfig: batchConfig(),
          wait: jest
            .fn()
            .mockResolvedValueOnce(planCompleted(validQueries))
            .mockResolvedValueOnce(scoreCompleted([brand('a.example', 80)]))
            .mockResolvedValueOnce(scoreFailed('SCORE_FAILED', 'model timeout'))
            .mockResolvedValueOnce(scoreCompleted([brand('c.example', 60)])),
        });

        const result = await orchestrator.orchestrate(baseParams);

        expect(result.brands.map((b) => b.website).sort()).toEqual([
          'https://a.example/',
          'https://c.example/',
        ]);
        expect(result.scoreBatches).toEqual({ total: 3, failed: 1, hitsPerBatch: 5 });
      });

      it('fails the run only when every batch fails', async () => {
        const { orchestrator } = build({
          search: jest.fn().mockResolvedValue(makeHits(40)),
          getConfig: batchConfig(),
          wait: jest
            .fn()
            .mockResolvedValueOnce(planCompleted(validQueries))
            .mockResolvedValue(scoreFailed('SCORE_FAILED', 'model timeout')),
        });

        await expect(orchestrator.orchestrate(baseParams)).rejects.toBeInstanceOf(
          BrandDiscoveryAiOrchestratorError,
        );
      });

      it('still runs SCORE once when there are zero hits', async () => {
        const { orchestrator, publishScore } = build({
          search: jest.fn().mockResolvedValue([]),
          getConfig: batchConfig(),
          wait: jest
            .fn()
            .mockResolvedValueOnce(planCompleted(validQueries))
            .mockResolvedValueOnce(scoreCompleted([])),
        });

        const result = await orchestrator.orchestrate(baseParams);

        expect(publishScore).toHaveBeenCalledTimes(1);
        expect((publishScore.mock.calls[0][0] as { searchHits: unknown[] }).searchHits).toEqual([]);
        expect(result.scoreBatches?.total).toBe(1);
      });
    });
  });
});
