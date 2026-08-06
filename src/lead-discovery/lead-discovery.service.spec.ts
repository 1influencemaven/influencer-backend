jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BrandCandidateStatus,
  LeadDiscoveryStatus,
  LeadStatus,
} from '../generated/prisma/enums';
import { LeadDiscoveryService } from './lead-discovery.service';
import { LeadSourceRegistry } from './lead-source.registry';
import { MockLeadSource } from './providers/mock.lead-source';

describe('LeadDiscoveryService', () => {
  const prisma = {
    brandCandidate: {
      findUnique: jest.fn(),
    },
    leadDiscoveryRun: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    lead: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const queue = { add: jest.fn() };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'LEAD_DISCOVERY_LIMIT') return 10;
      return undefined;
    }),
  } as unknown as ConfigService;

  const mockSource = new MockLeadSource();
  const registry = new LeadSourceRegistry(
    new Map([['brightdata', mockSource]]),
    configService,
  );

  const aiPromptsService = {
    getLeadDiscoveryInstructions: jest
      .fn()
      .mockResolvedValue('Lead discovery instructions'),
  };

  let service: LeadDiscoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadDiscoveryService(
      prisma as never,
      configService,
      registry,
      aiPromptsService as never,
      queue as never,
    );
  });
  it('lists providers', () => {
    expect(service.listProviders()).toEqual({
      available: ['brightdata'],
      default: 'brightdata',
    });
  });

  it('rejects non-approved brand candidates', async () => {
    prisma.brandCandidate.findUnique.mockResolvedValue({
      id: 'b1',
      name: 'Acme',
      website: 'https://acme.com',
      domain: 'acme.com',
      status: BrandCandidateStatus.UNDER_REVIEW,
      influencerId: 'i1',
    });

    await expect(
      service.search({
        brandCandidateIds: ['b1'],
        providerId: 'brightdata',
        options: { optionIds: ['gd_me5ppxjr2ge6icjuh0'] },
        limit: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enqueues search for approved brands', async () => {
    prisma.brandCandidate.findUnique.mockResolvedValue({
      id: 'b1',
      name: 'Acme',
      website: 'https://acme.com',
      domain: 'acme.com',
      status: BrandCandidateStatus.APPROVED,
      influencerId: 'i1',
    });
    prisma.leadDiscoveryRun.findFirst.mockResolvedValue(null);
    prisma.leadDiscoveryRun.create.mockResolvedValue({
      id: 'run1',
      brandCandidateId: 'b1',
      influencerId: 'i1',
      status: LeadDiscoveryStatus.PROCESSING,
      providerId: 'brightdata',
      limit: 5,
    });

    const result = await service.search({
      brandCandidateIds: ['b1'],
      providerId: 'brightdata',
      options: { optionIds: ['gd_me5ppxjr2ge6icjuh0'] },
      limit: 5,
    });

    expect(queue.add).toHaveBeenCalled();
    expect(result.runs).toHaveLength(1);
  });

  it('conflicts when a run is already processing', async () => {
    prisma.brandCandidate.findUnique.mockResolvedValue({
      id: 'b1',
      name: 'Acme',
      website: 'https://acme.com',
      domain: 'acme.com',
      status: BrandCandidateStatus.APPROVED,
      influencerId: 'i1',
    });
    prisma.leadDiscoveryRun.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.search({
        brandCandidateIds: ['b1'],
        providerId: 'brightdata',
        options: { optionIds: ['gd_me5ppxjr2ge6icjuh0'] },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates lead status', async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
    prisma.lead.update.mockResolvedValue({
      id: 'l1',
      status: LeadStatus.APPROVED,
    });

    const updated = await service.updateLeadStatus('l1', {
      status: LeadStatus.APPROVED,
    });
    expect(updated.status).toBe(LeadStatus.APPROVED);
  });
});
