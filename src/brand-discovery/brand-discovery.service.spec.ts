import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AiPromptsService } from '../ai-prompts/ai-prompts.service';
import { QUEUES } from '../bullmq/queue.constants';
import {
  BrandCandidateStatus,
  BrandDiscoveryStatus,
  EvidenceStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { BrandDiscoveryAiOrchestrator } from './brand-discovery-ai.orchestrator';
import { BrandDiscoveryAiOrchestratorError } from './brand-discovery-ai.orchestrator.errors';
import { BrandDiscoveryResearchService } from './brand-discovery-research.service';
import {
  BrandDiscoveryService,
  brandCandidateSelect,
} from './brand-discovery.service';
import { BrandSourceRegistry } from './brand-source.registry';
import type { RawBrandCandidate } from './interfaces/brand-source-provider.interface';
import { AI_EXECUTION_WAIT_ERROR_CODES } from '../ai-execution/ai-execution-result-wait.errors';

describe('BrandDiscoveryService.executeDiscovery', () => {
  let service: BrandDiscoveryService;

  const discover = jest.fn();
  const orchestrate = jest.fn();
  const enrichCandidates = jest.fn(
    async (candidates: RawBrandCandidate[]) => ({
      candidates,
      researchedCount: 0,
      researchFailedCount: 0,
      researchPartialCount: 0,
      researchConcurrency: 2,
    }),
  );

  const prismaService = {
    brandDiscoveryRun: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    influencer: {
      findUnique: jest.fn(),
    },
    brandCandidate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const aiPromptsService = {
    getBrandDiscoveryInstructions: jest.fn(),
  };

  const brandSourceRegistry = {
    resolve: jest.fn(),
  };

  const prospectingQueue = {
    add: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  const ibpSnapshot = {
    targetSectors: ['software'],
    excludedSectors: ['gambling'],
    brandSize: ['smb'],
    markets: ['Global'],
    collaborationTypes: ['sponsorship'],
    summary: 'Tech brands',
    alertSignals: [],
    desirableCriteria: [],
  };

  function candidate(
    name: string,
    domain: string,
    overrides: Partial<RawBrandCandidate> = {},
  ): RawBrandCandidate {
    return {
      name,
      website: `https://${domain}`,
      domain,
      sector: 'software',
      market: 'Global',
      brandSize: 'smb',
      score: 80,
      fitReason: 'fit',
      source: 'ai+tavily',
      evidenceUrls: [`https://${domain}`],
      ...overrides,
    };
  }

  function scored(
    name: string,
    domain: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      name,
      website: `https://${domain}`,
      sector: 'software',
      market: 'Global',
      brandSize: 'smb',
      score: 80,
      fitReason: 'fit',
      evidenceUrls: [`https://${domain}/about`],
      ...overrides,
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandDiscoveryService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: AiPromptsService, useValue: aiPromptsService },
        { provide: BrandSourceRegistry, useValue: brandSourceRegistry },
        {
          provide: BrandDiscoveryAiOrchestrator,
          useValue: { orchestrate },
        },
        {
          provide: BrandDiscoveryResearchService,
          useValue: { enrichCandidates },
        },
        {
          provide: getQueueToken(QUEUES.PROSPECTING),
          useValue: prospectingQueue,
        },
      ],
    }).compile();

    service = module.get(BrandDiscoveryService);
    jest.clearAllMocks();
    enrichCandidates.mockImplementation(async (candidates: RawBrandCandidate[]) => ({
      candidates,
      researchedCount: 0,
      researchFailedCount: 0,
      researchPartialCount: 0,
      researchConcurrency: 2,
    }));

    configService.get.mockImplementation((key: string) => {
      if (key === 'BRAND_DISCOVERY_ENGINE') return 'legacy';
      return undefined;
    });

    aiPromptsService.getBrandDiscoveryInstructions.mockResolvedValue(
      'Brand instructions',
    );
    brandSourceRegistry.resolve.mockReturnValue({
      id: 'brightdata',
      provider: { name: 'ai+brightdata', discover },
    });

    prismaService.brandDiscoveryRun.findUnique.mockResolvedValue({
      id: 'run-2',
      influencerId: 'inf-1',
      limit: 2,
      ibpSnapshot,
      status: BrandDiscoveryStatus.PROCESSING,
    });
    prismaService.influencer.findUnique.mockResolvedValue({
      id: 'inf-1',
      name: 'Ada',
      niche: 'tech',
      countries: ['ES'],
    });

    prismaService.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaService) => Promise<unknown>) =>
        fn(prismaService),
    );
    prismaService.brandDiscoveryRun.update.mockResolvedValue({});
    prismaService.brandCandidate.createMany.mockResolvedValue({ count: 0 });
  });

  it('selects legacy engine and uses BrandSourceRegistry', async () => {
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    discover.mockResolvedValue({
      candidates: [candidate('Senic', 'senic.com')],
      searchMetadata: null,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(discover).toHaveBeenCalled();
    expect(orchestrate).not.toHaveBeenCalled();
  });

  it('selects mastra engine and does not call legacy discover', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['software brands Global'],
      searchHits: [
        { title: 'Senic', url: 'https://senic.com/about', content: 'x' },
      ],
      searchHitsCount: 1,
      brands: [scored('Senic', 'senic.com')],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(orchestrate).toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
  });

  it('mastra success persists candidates after evidence + hard filters', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [
        { title: 'Senic', url: 'https://senic.com/about', content: 'x' },
        { title: 'Acme', url: 'https://acme.com/about', content: 'y' },
      ],
      searchHitsCount: 2,
      brands: [
        scored('Senic', 'senic.com'),
        scored('Acme', 'acme.com'),
        scored('Fake', 'fake.example', {
          evidenceUrls: ['https://invented.example/x'],
        }),
      ],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(prismaService.brandCandidate.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          name: 'Senic',
          domain: 'senic.com',
          source: 'mastra',
          status: BrandCandidateStatus.UNDER_REVIEW,
          evidenceStatus: EvidenceStatus.VERIFIED,
        }),
        expect.objectContaining({
          name: 'Acme',
          domain: 'acme.com',
          evidenceStatus: EvidenceStatus.VERIFIED,
        }),
      ]),
    });
    const created =
      prismaService.brandCandidate.createMany.mock.calls[0][0].data;
    expect(created.map((row: { name: string }) => row.name)).not.toContain(
      'Fake',
    );
    expect(
      created.every(
        (row: { evidenceStatus: EvidenceStatus }) =>
          row.evidenceStatus === EvidenceStatus.VERIFIED,
      ),
    ).toBe(true);
  });

  it('keeps global-market brands when IBP markets are regional (mastra)', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandDiscoveryRun.findUnique.mockResolvedValue({
      id: 'run-2',
      influencerId: 'inf-1',
      limit: 5,
      status: BrandDiscoveryStatus.PROCESSING,
      ibpSnapshot: { ...ibpSnapshot, markets: ['Spain', 'LATAM'] },
    });
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [
        { title: 'GlobalCo', url: 'https://globalco.example/about', content: 'x' },
        { title: 'LocalCo', url: 'https://localco.example/about', content: 'y' },
      ],
      searchHitsCount: 2,
      brands: [
        scored('GlobalCo', 'globalco.example', { market: 'global' }),
        scored('LocalCo', 'localco.example', { market: 'Spain' }),
        scored('UsOnly', 'usonly.example', { market: 'USA' }),
      ],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    const names =
      prismaService.brandCandidate.createMany.mock.calls[0][0].data.map(
        (row: { name: string }) => row.name,
      );
    expect(names).toEqual(['GlobalCo', 'LocalCo']);
  });

  it('applies hard filters on mastra path (excluded sector)', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [
        { title: 'Casino', url: 'https://casino.example/about', content: 'x' },
        { title: 'Senic', url: 'https://senic.com/about', content: 'y' },
      ],
      searchHitsCount: 2,
      brands: [
        scored('Casino', 'casino.example', { sector: 'gambling' }),
        scored('Senic', 'senic.com'),
      ],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    const names =
      prismaService.brandCandidate.createMany.mock.calls[0][0].data.map(
        (row: { name: string }) => row.name,
      );
    expect(names).toEqual(['Senic']);
  });

  it('dedupes by domain on mastra path', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [
        { title: 'A', url: 'https://senic.com/a', content: 'x' },
        { title: 'B', url: 'https://senic.com/b', content: 'y' },
      ],
      searchHitsCount: 2,
      brands: [
        scored('Senic', 'senic.com', {
          evidenceUrls: ['https://senic.com/a'],
        }),
        scored('Senic Dup', 'senic.com', {
          evidenceUrls: ['https://senic.com/b'],
          score: 90,
        }),
      ],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(
      prismaService.brandCandidate.createMany.mock.calls[0][0].data,
    ).toHaveLength(1);
  });

  it('excludes existing domains on mastra path', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([
      { domain: 'movavi.com' },
    ]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [
        { title: 'Movavi', url: 'https://movavi.com/about', content: 'x' },
        { title: 'Senic', url: 'https://senic.com/about', content: 'y' },
      ],
      searchHitsCount: 2,
      brands: [scored('Movavi', 'movavi.com'), scored('Senic', 'senic.com')],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(prismaService.brandCandidate.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ name: 'Senic', domain: 'senic.com' })],
    });
  });

  it('completes with zero candidates when SERP yields no hits and SCORE returns empty (mastra)', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [],
      searchHitsCount: 0,
      brands: [],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-empty-serp',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
      serpQueryFallbackUsed: false,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(orchestrate).toHaveBeenCalled();
    expect(prismaService.brandCandidate.createMany).not.toHaveBeenCalled();
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: expect.objectContaining({
        status: BrandDiscoveryStatus.COMPLETED,
        searchMetadata: expect.objectContaining({
          engine: 'mastra',
          searchHitsCount: 0,
          scoreExecutionId: 'score-empty-serp',
          scoredBrandsCount: 0,
          persistedCount: 0,
          skippedPersistReason: 'NO_SERP_HITS',
        }),
      }),
    });
  });

  it('skips persisting SCORE inventados when searchHitsCount is 0 (mastra)', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [],
      searchHitsCount: 0,
      brands: [scored('Invented Co', 'invented.example')],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
      serpQueryFallbackUsed: true,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(prismaService.brandCandidate.createMany).not.toHaveBeenCalled();
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: expect.objectContaining({
        searchMetadata: expect.objectContaining({
          skippedPersistReason: 'NO_SERP_HITS',
          persistedCount: 0,
          serpQueryFallbackUsed: true,
        }),
      }),
    });
  });

  it('does not persist MODEL_PRIOR when SERP hits are for a foreign domain (mastra)', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [
        { title: 'Real', url: 'https://real.example/a', content: 'x' },
      ],
      searchHitsCount: 1,
      brands: [
        scored('Fake', 'fake.example', {
          evidenceUrls: ['https://invented.example/x'],
        }),
      ],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(prismaService.brandCandidate.createMany).not.toHaveBeenCalled();
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
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

  it('discards empty-website brands and does not persist them (mastra)', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [
        { title: 'Real', url: 'https://real.example/a', content: 'x' },
      ],
      searchHitsCount: 1,
      brands: [
        {
          name: 'NoSite',
          website: '',
          score: 50,
          fitReason: 'n/a',
          evidenceUrls: [],
          sector: 'software',
          market: 'Global',
        },
      ],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(prismaService.brandCandidate.createMany).not.toHaveBeenCalled();
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: expect.objectContaining({
        searchMetadata: expect.objectContaining({
          verifiedCount: 0,
          unverifiedCount: 0,
          discardedByEvidenceCount: 1,
          persistedCount: 0,
        }),
      }),
    });
  });

  it('marks FAILED on PLAN_SEARCH error without legacy fallback', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockRejectedValue(
      new BrandDiscoveryAiOrchestratorError('AI_PROVIDER_ERROR', 'LLM down', {
        executionId: 'plan-1',
      }),
    );

    await expect(service.executeDiscovery('run-2', 'inf-1')).rejects.toThrow(
      'LLM down',
    );
    expect(discover).not.toHaveBeenCalled();
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: {
        status: BrandDiscoveryStatus.FAILED,
        errorMessage: 'LLM down',
      },
    });
  });

  it('marks FAILED on SCORE_CANDIDATES error without legacy fallback', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockRejectedValue(
      new BrandDiscoveryAiOrchestratorError(
        'AI_PROVIDER_ERROR',
        'score failed',
        { executionId: 'score-1' },
      ),
    );

    await expect(service.executeDiscovery('run-2', 'inf-1')).rejects.toThrow(
      'score failed',
    );
    expect(discover).not.toHaveBeenCalled();
  });

  it('marks FAILED on wait timeout without legacy fallback', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockRejectedValue(
      new BrandDiscoveryAiOrchestratorError(
        AI_EXECUTION_WAIT_ERROR_CODES.TIMEOUT,
        'PLAN_SEARCH wait failed: timed out',
        { executionId: 'plan-1' },
      ),
    );

    await expect(service.executeDiscovery('run-2', 'inf-1')).rejects.toThrow(
      /timed out/,
    );
    expect(discover).not.toHaveBeenCalled();
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: expect.objectContaining({
        status: BrandDiscoveryStatus.FAILED,
      }),
    });
  });

  it('marks FAILED on infrastructure error without legacy fallback', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockRejectedValue(
      new BrandDiscoveryAiOrchestratorError(
        AI_EXECUTION_WAIT_ERROR_CODES.INFRASTRUCTURE,
        'ECONNREFUSED Redis',
        { executionId: 'plan-1' },
      ),
    );

    await expect(service.executeDiscovery('run-2', 'inf-1')).rejects.toThrow(
      /ECONNREFUSED/,
    );
    expect(discover).not.toHaveBeenCalled();
  });

  it('marks FAILED when persistence throws after mastra success', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['q1'],
      searchHits: [
        { title: 'Senic', url: 'https://senic.com/about', content: 'x' },
      ],
      searchHitsCount: 1,
      brands: [scored('Senic', 'senic.com')],
      planExecutionId: 'plan-1',
      scoreExecutionId: 'score-1',
      strategy: 'llm',
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
    });
    prismaService.$transaction.mockRejectedValue(new Error('db down'));

    await expect(service.executeDiscovery('run-2', 'inf-1')).rejects.toThrow(
      'db down',
    );
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: {
        status: BrandDiscoveryStatus.FAILED,
        errorMessage: 'db down',
      },
    });
  });

  it('stores mastra searchMetadata with execution ids and counts', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'BRAND_DISCOVERY_ENGINE' ? 'mastra' : undefined,
    );
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    orchestrate.mockResolvedValue({
      queries: ['software brands'],
      searchHits: [
        { title: 'Senic', url: 'https://senic.com/about', content: 'x' },
      ],
      searchHitsCount: 1,
      brands: [scored('Senic', 'senic.com')],
      planExecutionId: 'plan-uuid',
      scoreExecutionId: 'score-uuid',
      strategy: 'llm',
      plannedQueriesCount: 2,
      validatedQueriesCount: 1,
      fallbackUsed: true,
      geoLensesMode: 'legacy' as const,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: {
        status: BrandDiscoveryStatus.COMPLETED,
        searchMetadata: expect.objectContaining({
          engine: 'mastra',
          planExecutionId: 'plan-uuid',
          scoreExecutionId: 'score-uuid',
          queries: ['software brands'],
          searchHitsCount: 1,
          scoredBrandsCount: 1,
          evidenceAcceptedCount: 1,
          fallbackUsed: true,
      geoLensesMode: 'legacy' as const,
          persistedCount: 1,
        }),
      },
    });
  });

  it('does not re-persist Movavi when domain already exists; keeps novel brands (legacy)', async () => {
    prismaService.brandCandidate.findMany.mockResolvedValue([
      { domain: 'movavi.com' },
      { domain: 'infinixmobility.com' },
    ]);

    discover.mockResolvedValue({
      candidates: [
        candidate('Movavi', 'movavi.com'),
        candidate('Senic', 'senic.com'),
      ],
      searchMetadata: null,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 4 }),
    );
    expect(prismaService.brandCandidate.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          name: 'Senic',
          domain: 'senic.com',
          status: BrandCandidateStatus.UNDER_REVIEW,
          evidenceStatus: EvidenceStatus.NOT_ASSESSED,
        }),
      ],
    });
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: {
        status: BrandDiscoveryStatus.COMPLETED,
        searchMetadata: { engine: 'legacy' },
      },
    });
  });

  it('persists Legacy candidates as NOT_ASSESSED even when evidenceUrls are present', async () => {
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    discover.mockResolvedValue({
      candidates: [
        candidate('Senic', 'senic.com', {
          evidenceUrls: ['https://senic.com/about', 'https://news.example/x'],
        }),
      ],
      searchMetadata: null,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(prismaService.brandCandidate.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          name: 'Senic',
          evidenceUrls: ['https://senic.com/about', 'https://news.example/x'],
          evidenceStatus: EvidenceStatus.NOT_ASSESSED,
        }),
      ],
    });
  });

  it('persists legacy searchMetadata with engine tag', async () => {
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    const searchMetadata = {
      strategy: 'llm' as const,
      queries: ['software brands Global creator partnerships'],
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
      geoLensesMode: 'legacy' as const,
      searchHitsCount: 6,
    };
    discover.mockResolvedValue({
      candidates: [candidate('Senic', 'senic.com')],
      searchMetadata,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: {
        status: BrandDiscoveryStatus.COMPLETED,
        searchMetadata: { ...searchMetadata, engine: 'legacy' },
      },
    });
  });

  it('fills up to run.limit with novel brands after excluding existing (legacy)', async () => {
    prismaService.brandCandidate.findMany.mockResolvedValue([
      { domain: 'movavi.com' },
    ]);

    discover.mockResolvedValue({
      candidates: [
        candidate('Movavi', 'movavi.com', { score: 95 }),
        candidate('Senic', 'senic.com', { score: 90 }),
        candidate('Acme', 'acme.com', { score: 85 }),
        candidate('Beta', 'beta.com', { score: 70 }),
      ],
      searchMetadata: null,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    const createArg = prismaService.brandCandidate.createMany.mock.calls[0][0];
    expect(createArg.data).toHaveLength(2);
    expect(createArg.data.map((row: { name: string }) => row.name)).toEqual([
      'Senic',
      'Acme',
    ]);
  });

  it('completes run with zero creates when all candidates already exist (legacy)', async () => {
    prismaService.brandCandidate.findMany.mockResolvedValue([
      { domain: 'movavi.com' },
      { domain: 'senic.com' },
    ]);
    discover.mockResolvedValue({
      candidates: [
        candidate('Movavi', 'movavi.com'),
        candidate('Senic', 'www.senic.com'),
      ],
      searchMetadata: null,
    });

    await service.executeDiscovery('run-2', 'inf-1');

    expect(prismaService.brandCandidate.createMany).not.toHaveBeenCalled();
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: {
        status: BrandDiscoveryStatus.COMPLETED,
        searchMetadata: { engine: 'legacy' },
      },
    });
  });
});

describe('BrandDiscoveryService.removeCandidate', () => {
  let service: BrandDiscoveryService;

  const prismaService = {
    brandDiscoveryRun: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    influencer: {
      findUnique: jest.fn(),
    },
    brandCandidate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const aiPromptsService = {
    getBrandDiscoveryInstructions: jest.fn(),
  };

  const brandSourceRegistry = {
    resolve: jest.fn(),
  };

  const prospectingQueue = {
    add: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandDiscoveryService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: AiPromptsService, useValue: aiPromptsService },
        { provide: BrandSourceRegistry, useValue: brandSourceRegistry },
        {
          provide: BrandDiscoveryAiOrchestrator,
          useValue: { orchestrate: jest.fn() },
        },
        {
          provide: BrandDiscoveryResearchService,
          useValue: { enrichCandidates: jest.fn() },
        },
        {
          provide: getQueueToken(QUEUES.PROSPECTING),
          useValue: prospectingQueue,
        },
      ],
    }).compile();

    service = module.get(BrandDiscoveryService);
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaService) => Promise<unknown>) =>
        fn(prismaService),
    );
  });

  it('throws NotFoundException when candidate does not exist', async () => {
    prismaService.brandCandidate.findUnique.mockResolvedValue(null);

    await expect(service.removeCandidate('missing')).rejects.toThrow(
      NotFoundException,
    );
    expect(prismaService.brandCandidate.delete).not.toHaveBeenCalled();
  });

  it('clears selectedLeadId then deletes the candidate', async () => {
    prismaService.brandCandidate.findUnique.mockResolvedValue({ id: 'bc-1' });
    prismaService.brandCandidate.update.mockResolvedValue({ id: 'bc-1' });
    prismaService.brandCandidate.delete.mockResolvedValue({ id: 'bc-1' });

    await service.removeCandidate('bc-1');

    expect(prismaService.brandCandidate.update).toHaveBeenCalledWith({
      where: { id: 'bc-1' },
      data: { selectedLeadId: null },
    });
    expect(prismaService.brandCandidate.delete).toHaveBeenCalledWith({
      where: { id: 'bc-1' },
    });
  });

  it('deletes APPROVED candidates that already have leads', async () => {
    prismaService.brandCandidate.findUnique.mockResolvedValue({
      id: 'bc-approved',
    });
    prismaService.brandCandidate.update.mockResolvedValue({
      id: 'bc-approved',
    });
    prismaService.brandCandidate.delete.mockResolvedValue({
      id: 'bc-approved',
    });

    await expect(
      service.removeCandidate('bc-approved'),
    ).resolves.toBeUndefined();
    expect(prismaService.brandCandidate.delete).toHaveBeenCalledWith({
      where: { id: 'bc-approved' },
    });
  });
});

describe('BrandDiscoveryService.listCandidates (evidenceStatus API)', () => {
  let service: BrandDiscoveryService;

  const prismaService = {
    brandCandidate: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandDiscoveryService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: AiPromptsService,
          useValue: { getBrandDiscoveryInstructions: jest.fn() },
        },
        {
          provide: BrandSourceRegistry,
          useValue: { resolve: jest.fn() },
        },
        {
          provide: BrandDiscoveryAiOrchestrator,
          useValue: { orchestrate: jest.fn() },
        },
        {
          provide: BrandDiscoveryResearchService,
          useValue: { enrichCandidates: jest.fn() },
        },
        {
          provide: getQueueToken(QUEUES.PROSPECTING),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(BrandDiscoveryService);
    jest.clearAllMocks();
  });

  it('exposes evidenceStatus in the candidate select (additive field)', () => {
    expect(brandCandidateSelect.evidenceStatus).toBe(true);
    expect(brandCandidateSelect.evidenceUrls).toBe(true);
    expect(brandCandidateSelect.status).toBe(true);
  });

  it('lists candidates via select that includes evidenceStatus', async () => {
    prismaService.brandCandidate.findMany.mockResolvedValue([
      {
        id: 'bc-1',
        name: 'Senic',
        evidenceUrls: ['https://senic.com/about'],
        evidenceStatus: EvidenceStatus.VERIFIED,
        status: BrandCandidateStatus.UNDER_REVIEW,
      },
      {
        id: 'bc-2',
        name: 'Legacy Co',
        evidenceUrls: ['https://legacy.example'],
        evidenceStatus: EvidenceStatus.NOT_ASSESSED,
        status: BrandCandidateStatus.APPROVED,
      },
    ]);

    const result = await service.listCandidates({ influencerId: 'inf-1' });

    expect(prismaService.brandCandidate.findMany).toHaveBeenCalledWith({
      where: {
        influencerId: 'inf-1',
        discoveryRunId: undefined,
        status: undefined,
      },
      select: brandCandidateSelect,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    });
    expect(result[0].evidenceStatus).toBe(EvidenceStatus.VERIFIED);
    expect(result[1].evidenceStatus).toBe(EvidenceStatus.NOT_ASSESSED);
  });
});
