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
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { BrandDiscoveryService } from './brand-discovery.service';
import { BrandSourceRegistry } from './brand-source.registry';
import type { RawBrandCandidate } from './interfaces/brand-source-provider.interface';

describe('BrandDiscoveryService.executeDiscovery cross-run dedupe', () => {
  let service: BrandDiscoveryService;

  const discover = jest.fn();

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
    excludedSectors: [],
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandDiscoveryService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: AiPromptsService, useValue: aiPromptsService },
        { provide: BrandSourceRegistry, useValue: brandSourceRegistry },
        {
          provide: getQueueToken(QUEUES.PROSPECTING),
          useValue: prospectingQueue,
        },
      ],
    }).compile();

    service = module.get(BrandDiscoveryService);
    jest.clearAllMocks();

    aiPromptsService.getBrandDiscoveryInstructions.mockResolvedValue(
      'Brand instructions',
    );
    brandSourceRegistry.resolve.mockReturnValue({
      id: 'tavily',
      provider: { name: 'ai+tavily', discover },
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
    });

    prismaService.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaService) => Promise<unknown>) => fn(prismaService),
    );
    prismaService.brandDiscoveryRun.update.mockResolvedValue({});
    prismaService.brandCandidate.createMany.mockResolvedValue({ count: 0 });
  });

  it('does not re-persist Movavi when domain already exists; keeps novel brands', async () => {
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
        }),
      ],
    });
    expect(prismaService.brandDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: { status: BrandDiscoveryStatus.COMPLETED },
    });
  });

  it('persists searchMetadata on COMPLETED when provider returns it', async () => {
    prismaService.brandCandidate.findMany.mockResolvedValue([]);
    const searchMetadata = {
      strategy: 'llm' as const,
      queries: ['software brands Global creator partnerships'],
      plannedQueriesCount: 1,
      validatedQueriesCount: 1,
      fallbackUsed: false,
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
        searchMetadata,
      },
    });
  });

  it('fills up to run.limit with novel brands after excluding existing', async () => {
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

  it('completes run with zero creates when all candidates already exist', async () => {
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
      data: { status: BrandDiscoveryStatus.COMPLETED },
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
