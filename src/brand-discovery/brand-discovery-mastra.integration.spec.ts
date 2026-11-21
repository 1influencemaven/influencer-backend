/**
 * Integration: BrandDiscoveryService + real BrandDiscoveryAiOrchestrator.
 * Mocks at the BullMQ/SERP/Prisma/Settings boundary (no Ollama/Redis/Bright Data).
 * Unit suites cover isolated pieces; this file asserts pipeline wiring.
 *
 * Jest mock `.mock.calls` / `expect.objectContaining` are typed as `any` under
 * the project ESLint rules; disable unsafe-* here (same pattern as other Nest specs).
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import { AiPromptsService } from '../ai-prompts/ai-prompts.service';
import { AiExecutionPublisherService } from '../ai-execution/ai-execution-publisher.service';
import {
  AI_EXECUTION_WAIT_ERROR_CODES,
  AiExecutionWaitError,
} from '../ai-execution/ai-execution-result-wait.errors';
import { AiExecutionResultWaitService } from '../ai-execution/ai-execution-result-wait.service';
import { QUEUES } from '../bullmq/queue.constants';
import {
  BrandDiscoveryStatus,
  EvidenceStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  BrandDiscoveryAiOrchestrator,
  BRAND_DISCOVERY_SCORE_TIMEOUT_MS,
} from './brand-discovery-ai.orchestrator';
import { BrandDiscoveryResearchService } from './brand-discovery-research.service';
import { BrandDiscoveryService } from './brand-discovery.service';
import { BrandSourceRegistry } from './brand-source.registry';
import { BrightDataWebSearchProvider } from './providers/brightdata-web-search.provider';

const PLAN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCORE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CORR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Brand Discovery Mastra integration (Nest pipeline)', () => {
  let service: BrandDiscoveryService;

  const publishPlan = jest.fn();
  const publishScore = jest.fn();
  const waitForResult = jest.fn();
  const search = jest.fn();
  const discover = jest.fn();
  const getInstructions = jest.fn();

  const prisma = {
    brandDiscoveryRun: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    influencer: { findUnique: jest.fn() },
    brandCandidate: {
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const configGet = jest.fn();

  const ibp = {
    targetSectors: ['software'],
    excludedSectors: ['gambling'],
    brandSize: ['smb'],
    markets: ['Global'],
    collaborationTypes: ['sponsorship'],
    summary: 'Tech brands',
    alertSignals: [],
    desirableCriteria: [],
  };

  function planCompleted(queries: string[]) {
    return {
      contractVersion: AI_CONTRACT_VERSION,
      executionId: PLAN_ID,
      correlationId: CORR_ID,
      type: 'BRAND_DISCOVERY' as const,
      status: 'COMPLETED' as const,
      startedAt: '2026-11-01T20:00:00.000Z',
      finishedAt: '2026-11-01T20:00:03.000Z',
      durationMs: 3000,
      metadata: { provider: 'ollama', model: 'llama3.2:3b', llmCallCount: 1 },
      output: { operation: 'PLAN_SEARCH' as const, queries },
    };
  }

  function planFailed(code: string, message: string) {
    return {
      ...planCompleted([]),
      status: 'FAILED' as const,
      output: undefined,
      error: {
        code,
        message,
        retryable: false,
        occurredAt: '2026-11-01T20:00:03.000Z',
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
      sector?: string;
      market?: string;
      brandSize?: string;
    }>,
  ) {
    return {
      contractVersion: AI_CONTRACT_VERSION,
      executionId: SCORE_ID,
      correlationId: CORR_ID,
      type: 'BRAND_DISCOVERY' as const,
      status: 'COMPLETED' as const,
      startedAt: '2026-11-01T20:01:00.000Z',
      finishedAt: '2026-11-01T20:01:08.000Z',
      durationMs: 8000,
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
        occurredAt: '2026-11-01T20:01:08.000Z',
      },
    };
  }

  async function boot() {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandDiscoveryService,
        BrandDiscoveryAiOrchestrator,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: configGet } },
        {
          provide: AiPromptsService,
          useValue: { getBrandDiscoveryInstructions: getInstructions },
        },
        {
          provide: BrandSourceRegistry,
          useValue: {
            resolve: () => ({
              id: 'brightdata',
              provider: { name: 'ai+brightdata', discover },
            }),
          },
        },
        {
          provide: AiExecutionPublisherService,
          useValue: {
            publishBrandDiscoveryPlan: publishPlan,
            publishBrandDiscoveryScore: publishScore,
            publishBrandDiscoveryResearch: jest.fn(),
          },
        },
        {
          provide: AiExecutionResultWaitService,
          useValue: { waitForAiExecutionResult: waitForResult },
        },
        {
          provide: BrandDiscoveryResearchService,
          useValue: {
            enrichCandidates: jest.fn(
              async (candidates: unknown[]) => ({
                candidates,
                researchedCount: 0,
                researchFailedCount: 0,
                researchPartialCount: 0,
                researchConcurrency: 2,
              }),
            ),
          },
        },
        {
          provide: BrightDataWebSearchProvider,
          useValue: {
            name: 'brightdata',
            search,
            searchWithDiagnostics: jest
              .fn()
              .mockImplementation(async (query: string, options?: unknown) => {
                const hits = await search(query, options);
                return {
                  hits,
                  diagnostic: {
                    query,
                    resultCategory:
                      hits.length > 0 ? 'organic_results' : 'organic_empty',
                    httpStatus: 200,
                    responseBytes: 120,
                    latencyMs: 15,
                    attempts: 1,
                    organicResultsCount: hits.length,
                  },
                };
              }),
          },
        },
        {
          provide: getQueueToken(QUEUES.PROSPECTING),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(BrandDiscoveryService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    await boot();

    configGet.mockImplementation((key: string) => {
      if (key === 'BRAND_DISCOVERY_ENGINE') return 'mastra';
      if (key === 'BRAND_SEARCH_STRATEGY') return 'llm';
      if (key === 'NODE_ENV') return 'test';
      return undefined;
    });

    getInstructions.mockResolvedValue('Prefer official evidence');
    publishPlan.mockResolvedValue({
      executionId: PLAN_ID,
      correlationId: CORR_ID,
    });
    publishScore.mockResolvedValue({
      executionId: SCORE_ID,
      correlationId: CORR_ID,
    });

    prisma.brandDiscoveryRun.findUnique.mockResolvedValue({
      id: 'run-int-1',
      influencerId: 'inf-1',
      limit: 2,
      ibpSnapshot: ibp,
      status: BrandDiscoveryStatus.PROCESSING,
    });
    prisma.influencer.findUnique.mockResolvedValue({
      id: 'inf-1',
      name: 'Ada',
      niche: 'tech',
    });
    prisma.brandCandidate.findMany.mockResolvedValue([]);
    prisma.brandCandidate.createMany.mockResolvedValue({ count: 0 });
    prisma.brandDiscoveryRun.update.mockResolvedValue({});
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
  });

  describe('legacy engine', () => {
    beforeEach(() => {
      configGet.mockImplementation((key: string) => {
        if (key === 'BRAND_DISCOVERY_ENGINE') return 'legacy';
        return undefined;
      });
    });

    it('uses BrandSourceRegistry and never publishes Mastra jobs', async () => {
      discover.mockResolvedValue({
        candidates: [
          {
            name: 'Senic',
            website: 'https://senic.com',
            domain: 'senic.com',
            sector: 'software',
            market: 'Global',
            score: 80,
            fitReason: 'fit',
            source: 'ai+brightdata',
            evidenceUrls: ['https://senic.com'],
          },
        ],
        searchMetadata: {
          strategy: 'llm',
          queries: ['q'],
          plannedQueriesCount: 1,
          validatedQueriesCount: 1,
          fallbackUsed: false,
          searchHitsCount: 3,
        },
      });

      await service.executeDiscovery('run-int-1', 'inf-1');

      expect(discover).toHaveBeenCalled();
      expect(publishPlan).not.toHaveBeenCalled();
      expect(publishScore).not.toHaveBeenCalled();
      expect(waitForResult).not.toHaveBeenCalled();
      expect(search).not.toHaveBeenCalled();
      expect(prisma.brandCandidate.createMany).toHaveBeenCalled();
      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: expect.objectContaining({
          status: BrandDiscoveryStatus.COMPLETED,
          searchMetadata: expect.objectContaining({ engine: 'legacy' }),
        }),
      });
    });
  });

  describe('mastra happy path pipeline', () => {
    const validPlanQueries = [
      'software brands Global influencer marketing partnerships',
      'smb software companies Global sponsorship',
    ];

    function stubHappyPath(scoreBrands: Parameters<typeof scoreCompleted>[0]) {
      waitForResult
        .mockResolvedValueOnce(planCompleted(validPlanQueries))
        .mockResolvedValueOnce(scoreCompleted(scoreBrands));
      search.mockImplementation((query: string) =>
        Promise.resolve([
          {
            title: `Hit for ${query}`,
            url: 'https://senic.com/about',
            content: 'software',
          },
          {
            title: 'Acme',
            url: 'https://acme.com/about',
            content: 'tools',
          },
        ]),
      );
    }

    it('runs PLAN → SERP → SCORE → evidence → filters → persist with metadata', async () => {
      stubHappyPath([
        {
          name: 'Senic',
          website: 'https://senic.com',
          score: 88,
          fitReason: 'Strong fit',
          evidenceUrls: ['https://senic.com/about'],
          sector: 'software',
          market: 'Global',
        },
        {
          name: 'Acme',
          website: 'https://acme.com',
          score: 77,
          fitReason: 'Ok',
          evidenceUrls: ['https://acme.com/about'],
          sector: 'software',
          market: 'Global',
        },
        {
          name: 'Invented',
          website: 'https://invented.example',
          score: 99,
          fitReason: 'Hallucination',
          evidenceUrls: ['https://invented.example/x'],
          sector: 'software',
          market: 'Global',
        },
      ]);

      await service.executeDiscovery(
        'run-int-1',
        'inf-1',
        'Custom instructions',
      );

      expect(publishPlan).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-int-1', maxQueries: 4 }),
      );
      expect(waitForResult).toHaveBeenNthCalledWith(1, PLAN_ID, 120_000);
      expect(search).toHaveBeenCalled();
      expect(publishScore).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-int-1',
          promptInstructions: 'Custom instructions',
          searchHits: expect.arrayContaining([
            expect.objectContaining({ url: 'https://senic.com/about' }),
          ]),
        }),
      );
      expect(waitForResult).toHaveBeenNthCalledWith(
        2,
        SCORE_ID,
        BRAND_DISCOVERY_SCORE_TIMEOUT_MS,
      );
      expect(discover).not.toHaveBeenCalled();

      const created = prisma.brandCandidate.createMany.mock.calls[0][0]
        .data as Array<{
        name: string;
        source: string;
        domain: string;
        evidenceStatus: EvidenceStatus;
      }>;
      expect(created.map((c) => c.name).sort()).toEqual(['Acme', 'Senic']);
      expect(created.every((c) => c.source === 'mastra')).toBe(true);
      expect(
        created.every((c) => c.evidenceStatus === EvidenceStatus.VERIFIED),
      ).toBe(true);
      expect(created).toHaveLength(2);

      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: {
          status: BrandDiscoveryStatus.COMPLETED,
          searchMetadata: expect.objectContaining({
            engine: 'mastra',
            planExecutionId: PLAN_ID,
            scoreExecutionId: SCORE_ID,
            scoredBrandsCount: 3,
            verifiedCount: 2,
            unverifiedCount: 1,
            discardedByEvidenceCount: 0,
            evidenceAcceptedCount: 2,
            evidenceRejectedCount: 0,
            persistedCount: 2,
            fallbackUsed: false,
          }),
        },
      });
    });

    it('applies hard filters after evidence (excluded sector dropped)', async () => {
      waitForResult
        .mockResolvedValueOnce(planCompleted(validPlanQueries))
        .mockResolvedValueOnce(
          scoreCompleted([
            {
              name: 'CasinoSoft',
              website: 'https://casino.example',
              score: 90,
              fitReason: 'no',
              evidenceUrls: ['https://casino.example/about'],
              sector: 'gambling software',
              market: 'Global',
            },
            {
              name: 'Senic',
              website: 'https://senic.com',
              score: 80,
              fitReason: 'yes',
              evidenceUrls: ['https://senic.com/about'],
              sector: 'software',
              market: 'Global',
            },
          ]),
        );
      search.mockResolvedValue([
        {
          title: 'Casino',
          url: 'https://casino.example/about',
          content: 'x',
        },
        { title: 'Senic', url: 'https://senic.com/about', content: 'y' },
      ]);

      await service.executeDiscovery('run-int-1', 'inf-1');

      const names = (
        prisma.brandCandidate.createMany.mock.calls[0][0].data as Array<{
          name: string;
        }>
      ).map((r) => r.name);
      expect(names).toEqual(['Senic']);
      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: expect.objectContaining({
          searchMetadata: expect.objectContaining({
            evidenceAcceptedCount: 2,
            afterHardFiltersCount: 1,
            persistedCount: 1,
          }),
        }),
      });
    });

    it('dedupes domains and excludes existing before run.limit', async () => {
      prisma.brandCandidate.findMany.mockResolvedValue([
        { domain: 'movavi.com' },
      ]);
      prisma.brandDiscoveryRun.findUnique.mockResolvedValue({
        id: 'run-int-1',
        influencerId: 'inf-1',
        limit: 1,
        ibpSnapshot: ibp,
        status: BrandDiscoveryStatus.PROCESSING,
      });

      waitForResult
        .mockResolvedValueOnce(planCompleted(validPlanQueries))
        .mockResolvedValueOnce(
          scoreCompleted([
            {
              name: 'Movavi',
              website: 'https://movavi.com',
              score: 95,
              fitReason: 'existing',
              evidenceUrls: ['https://movavi.com/a'],
              sector: 'software',
              market: 'Global',
            },
            {
              name: 'Senic A',
              website: 'https://senic.com',
              score: 90,
              fitReason: 'a',
              evidenceUrls: ['https://senic.com/a'],
              sector: 'software',
              market: 'Global',
            },
            {
              name: 'Senic B',
              website: 'https://senic.com',
              score: 85,
              fitReason: 'dup',
              evidenceUrls: ['https://senic.com/b'],
              sector: 'software',
              market: 'Global',
            },
            {
              name: 'Acme',
              website: 'https://acme.com',
              score: 70,
              fitReason: 'c',
              evidenceUrls: ['https://acme.com/a'],
              sector: 'software',
              market: 'Global',
            },
          ]),
        );
      search.mockResolvedValue([
        { title: 'm', url: 'https://movavi.com/a', content: '' },
        { title: 's', url: 'https://senic.com/a', content: '' },
        { title: 's2', url: 'https://senic.com/b', content: '' },
        { title: 'a', url: 'https://acme.com/a', content: '' },
      ]);

      await service.executeDiscovery('run-int-1', 'inf-1');

      const created = prisma.brandCandidate.createMany.mock.calls[0][0]
        .data as Array<{ name: string; domain: string }>;
      expect(created).toHaveLength(1);
      expect(created[0].domain).toBe('senic.com');
      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: expect.objectContaining({
          searchMetadata: expect.objectContaining({
            afterDedupeCount: 3,
            afterExcludeExistingCount: 2,
            persistedCount: 1,
          }),
        }),
      });
    });
  });

  describe('mastra edge cases', () => {
    it('falls back to template queries when PLAN returns only invalid queries', async () => {
      waitForResult
        .mockResolvedValueOnce(
          planCompleted(['best brands', 'x', 'gambling software Global']),
        )
        .mockResolvedValueOnce(
          scoreCompleted([
            {
              name: 'Senic',
              website: 'https://senic.com',
              score: 80,
              fitReason: 'ok',
              evidenceUrls: ['https://senic.com/about'],
              sector: 'software',
              market: 'Global',
            },
          ]),
        );
      search.mockResolvedValue([
        { title: 'Senic', url: 'https://senic.com/about', content: 'x' },
      ]);

      await service.executeDiscovery('run-int-1', 'inf-1');

      expect(search).toHaveBeenCalled();
      expect(publishScore).toHaveBeenCalled();
      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: expect.objectContaining({
          status: BrandDiscoveryStatus.COMPLETED,
          searchMetadata: expect.objectContaining({
            fallbackUsed: true,
            engine: 'mastra',
          }),
        }),
      });
    });

    it('does not persist MODEL_PRIOR inventados when SERP returns no hits', async () => {
      waitForResult
        .mockResolvedValueOnce(
          planCompleted([
            'software brands Global influencer marketing partnerships',
          ]),
        )
        .mockResolvedValueOnce(
          scoreCompleted([
            {
              name: 'Knowledge Co',
              website: 'https://knowledge.example',
              score: 75,
              fitReason: 'IBP fit without SERP',
              evidenceUrls: [],
              sector: 'software',
              market: 'Global',
            },
          ]),
        );
      search.mockResolvedValue([]);

      await service.executeDiscovery('run-int-1', 'inf-1');

      expect(publishScore).toHaveBeenCalledWith(
        expect.objectContaining({ searchHits: [] }),
      );
      expect(prisma.brandCandidate.createMany).not.toHaveBeenCalled();
      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: expect.objectContaining({
          status: BrandDiscoveryStatus.COMPLETED,
          searchMetadata: expect.objectContaining({
            searchHitsCount: 0,
            scoreExecutionId: SCORE_ID,
            scoredBrandsCount: 1,
            verifiedCount: 0,
            unverifiedCount: 1,
            discardedByEvidenceCount: 0,
            persistedCount: 0,
            skippedPersistReason: 'NO_SERP_HITS',
          }),
        }),
      });
    });

    it('completes with zero candidates when SCORE returns empty brands', async () => {
      waitForResult
        .mockResolvedValueOnce(
          planCompleted([
            'software brands Global influencer marketing partnerships',
          ]),
        )
        .mockResolvedValueOnce(scoreCompleted([]));
      search.mockResolvedValue([
        { title: 'Senic', url: 'https://senic.com/about', content: 'x' },
      ]);

      await service.executeDiscovery('run-int-1', 'inf-1');

      expect(prisma.brandCandidate.createMany).not.toHaveBeenCalled();
      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: expect.objectContaining({
          status: BrandDiscoveryStatus.COMPLETED,
          searchMetadata: expect.objectContaining({
            scoredBrandsCount: 0,
            persistedCount: 0,
          }),
        }),
      });
    });

    it('does not persist MODEL_PRIOR when SCORE brand domain is outside SERP allowlist', async () => {
      waitForResult
        .mockResolvedValueOnce(
          planCompleted([
            'software brands Global influencer marketing partnerships',
          ]),
        )
        .mockResolvedValueOnce(
          scoreCompleted([
            {
              name: 'Fake',
              website: 'https://fake.example',
              score: 99,
              fitReason: 'no',
              evidenceUrls: ['https://invented.example/x'],
              sector: 'software',
              market: 'Global',
            },
          ]),
        );
      search.mockResolvedValue([
        { title: 'Real', url: 'https://real.example/a', content: 'x' },
      ]);

      await service.executeDiscovery('run-int-1', 'inf-1');

      expect(prisma.brandCandidate.createMany).not.toHaveBeenCalled();
      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: expect.objectContaining({
          status: BrandDiscoveryStatus.COMPLETED,
          searchMetadata: expect.objectContaining({
            verifiedCount: 0,
            unverifiedCount: 1,
            discardedByEvidenceCount: 0,
            evidenceAcceptedCount: 0,
            evidenceRejectedCount: 0,
            skippedModelPriorCount: 1,
            persistedCount: 0,
            skippedPersistReason: 'MODEL_PRIOR_WITHOUT_DOMAIN_EVIDENCE',
          }),
        }),
      });
    });

    it('keeps authorized evidenceUrls on VERIFIED brands', async () => {
      waitForResult
        .mockResolvedValueOnce(
          planCompleted([
            'software brands Global influencer marketing partnerships',
          ]),
        )
        .mockResolvedValueOnce(
          scoreCompleted([
            {
              name: 'Senic',
              website: 'https://senic.com',
              score: 88,
              fitReason: 'Strong fit',
              evidenceUrls: [
                'https://senic.com/about',
                'https://invented.example/x',
              ],
              sector: 'software',
              market: 'Global',
            },
          ]),
        );
      search.mockResolvedValue([
        { title: 'Senic', url: 'https://senic.com/about', content: 'x' },
      ]);

      await service.executeDiscovery('run-int-1', 'inf-1');

      expect(prisma.brandCandidate.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            name: 'Senic',
            evidenceUrls: ['https://senic.com/about'],
            evidenceStatus: EvidenceStatus.VERIFIED,
            score: 88,
            metadata: expect.objectContaining({
              groundingSource: 'SEARCH_EVIDENCE',
              groundingProvenance: expect.objectContaining({
                serpMatched: true,
              }),
            }),
          }),
        ],
      });
      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: expect.objectContaining({
          searchMetadata: expect.objectContaining({
            verifiedCount: 1,
            unverifiedCount: 0,
            discardedByEvidenceCount: 0,
          }),
        }),
      });
    });
  });

  describe('mastra failures leave FAILED and never call legacy', () => {
    async function expectFailedWithoutLegacy(message: RegExp | string) {
      await expect(
        service.executeDiscovery('run-int-1', 'inf-1'),
      ).rejects.toThrow(message);
      expect(discover).not.toHaveBeenCalled();
      expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run-int-1' },
        data: expect.objectContaining({
          status: BrandDiscoveryStatus.FAILED,
        }),
      });
      const statuses = prisma.brandDiscoveryRun.update.mock.calls.map(
        (call) => call[0].data.status,
      );
      expect(statuses).not.toContain(BrandDiscoveryStatus.PROCESSING);
      expect(statuses).toContain(BrandDiscoveryStatus.FAILED);
    }

    it('PLAN_SEARCH FAILED', async () => {
      waitForResult.mockResolvedValueOnce(
        planFailed('AI_PROVIDER_ERROR', 'plan llm down'),
      );
      await expectFailedWithoutLegacy('plan llm down');
      expect(publishScore).not.toHaveBeenCalled();
    });

    it('SCORE_CANDIDATES FAILED', async () => {
      waitForResult
        .mockResolvedValueOnce(
          planCompleted([
            'software brands Global influencer marketing partnerships',
          ]),
        )
        .mockResolvedValueOnce(
          scoreFailed('AI_PROVIDER_ERROR', 'score llm down'),
        );
      search.mockResolvedValue([
        { title: 'Senic', url: 'https://senic.com/about', content: 'x' },
      ]);
      await expectFailedWithoutLegacy('score llm down');
    });

    it('wait timeout', async () => {
      waitForResult.mockRejectedValueOnce(
        new AiExecutionWaitError(
          AI_EXECUTION_WAIT_ERROR_CODES.TIMEOUT,
          'timed out',
          PLAN_ID,
        ),
      );
      await expectFailedWithoutLegacy(/timed out/);
    });

    it('infrastructure Redis error', async () => {
      waitForResult.mockRejectedValueOnce(
        new AiExecutionWaitError(
          AI_EXECUTION_WAIT_ERROR_CODES.INFRASTRUCTURE,
          'ECONNREFUSED Redis',
          PLAN_ID,
        ),
      );
      await expectFailedWithoutLegacy(/ECONNREFUSED/);
    });

    it('Prisma persistence failure after successful Mastra pipeline', async () => {
      waitForResult
        .mockResolvedValueOnce(
          planCompleted([
            'software brands Global influencer marketing partnerships',
          ]),
        )
        .mockResolvedValueOnce(
          scoreCompleted([
            {
              name: 'Senic',
              website: 'https://senic.com',
              score: 80,
              fitReason: 'ok',
              evidenceUrls: ['https://senic.com/about'],
              sector: 'software',
              market: 'Global',
            },
          ]),
        );
      search.mockResolvedValue([
        { title: 'Senic', url: 'https://senic.com/about', content: 'x' },
      ]);
      prisma.$transaction.mockRejectedValueOnce(new Error('db down'));

      await expectFailedWithoutLegacy('db down');
    });
  });

  it('run starts from PROCESSING fixture and ends COMPLETED on success', async () => {
    expect((await prisma.brandDiscoveryRun.findUnique()).status).toBe(
      BrandDiscoveryStatus.PROCESSING,
    );

    waitForResult
      .mockResolvedValueOnce(
        planCompleted([
          'software brands Global influencer marketing partnerships',
        ]),
      )
      .mockResolvedValueOnce(scoreCompleted([]));
    search.mockResolvedValue([
      { title: 'x', url: 'https://senic.com/about', content: '' },
    ]);

    await service.executeDiscovery('run-int-1', 'inf-1');

    expect(prisma.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-int-1' },
      data: expect.objectContaining({
        status: BrandDiscoveryStatus.COMPLETED,
      }),
    });
  });
});
