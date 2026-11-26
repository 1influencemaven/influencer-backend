jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BrandCandidateStatus,
  LeadDiscoveryStatus,
} from '../generated/prisma/enums';
import { DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS } from '../ai/prompts/generate-lead-discovery.prompt';
import { CONTACT_DISCOVERY_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import { MASTRA_CONTACT_EMAILS_PROVIDER_ID } from './constants';
import { ContactDiscoveryService } from './contact-discovery.service';
import { contactDiscoveryJobId } from './interfaces/discover-business-contacts-job.interface';

describe('ContactDiscoveryService', () => {
  const prisma = {
    brandCandidate: { findUnique: jest.fn() },
    leadDiscoveryRun: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const queue = { add: jest.fn() };
  const getLeadDiscoveryInstructions = jest.fn();
  const aiPromptsService = { getLeadDiscoveryInstructions };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'MAX_BRAND_BUSINESS_CONTACT_PAGES') return 12;
      if (key === 'LEAD_DISCOVERY_LIMIT') return 10;
      return undefined;
    }),
  } as unknown as ConfigService;

  let service: ContactDiscoveryService;

  const candidate = {
    id: 'b1',
    name: 'Acme',
    website: 'https://acme.com',
    domain: 'acme.com',
    status: BrandCandidateStatus.APPROVED,
    influencerId: 'i1',
  };

  const runRow = {
    id: 'run-bbc-1',
    brandCandidateId: 'b1',
    influencerId: 'i1',
    status: LeadDiscoveryStatus.PROCESSING,
    providerId: MASTRA_CONTACT_EMAILS_PROVIDER_ID,
    providerOptions: {
      mode: 'mastra-find-brand-emails',
      engine: 'mastra',
      searchConnected: true,
      autonomous: true,
    },
    limit: 10,
    searchMetadata: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    brandCandidate: {
      id: 'b1',
      name: 'Acme',
      website: 'https://acme.com',
      domain: 'acme.com',
      status: BrandCandidateStatus.APPROVED,
    },
    influencer: { id: 'i1', name: 'Inf' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.brandCandidate.findUnique.mockResolvedValue(candidate);
    prisma.leadDiscoveryRun.findFirst.mockResolvedValue(null);
    prisma.leadDiscoveryRun.create.mockResolvedValue(runRow);
    queue.add.mockResolvedValue({ id: contactDiscoveryJobId(runRow.id) });
    getLeadDiscoveryInstructions.mockResolvedValue(
      'Custom Lead Discovery prompt snapshot',
    );
    service = new ContactDiscoveryService(
      prisma as never,
      configService,
      queue as never,
      aiPromptsService as never,
    );
  });

  it('creates PROCESSING run with mastra-contact-emails and enqueues contact-discovery job', async () => {
    const result = await service.startBbcDiscovery({
      brandCandidateIds: ['b1'],
      limit: 5,
    });

    expect(result.message).toContain('Contact discovery BBC');
    expect(result.runs).toHaveLength(1);
    expect(prisma.leadDiscoveryRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: MASTRA_CONTACT_EMAILS_PROVIDER_ID,
          status: LeadDiscoveryStatus.PROCESSING,
          providerOptions: expect.objectContaining({
            mode: 'mastra-find-brand-emails',
            engine: 'mastra',
            searchConnected: true,
          }),
        }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      CONTACT_DISCOVERY_JOBS.DISCOVER_BUSINESS_CONTACTS,
      expect.objectContaining({
        runId: 'run-bbc-1',
        brandCandidateId: 'b1',
        website: 'https://acme.com',
        domain: 'acme.com',
        maxPages: 12,
        promptInstructions: 'Custom Lead Discovery prompt snapshot',
      }),
      expect.objectContaining({
        jobId: contactDiscoveryJobId('run-bbc-1'),
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    );
    expect(getLeadDiscoveryInstructions).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][0]).not.toBe('find-leads');
  });

  it('falls back to DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS when AiPromptsService is omitted', async () => {
    const fallbackService = new ContactDiscoveryService(
      prisma as never,
      configService,
      queue as never,
    );

    await fallbackService.startBbcDiscovery({ brandCandidateIds: ['b1'] });

    expect(queue.add).toHaveBeenCalledWith(
      CONTACT_DISCOVERY_JOBS.DISCOVER_BUSINESS_CONTACTS,
      expect.objectContaining({
        promptInstructions: DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS,
      }),
      expect.any(Object),
    );
  });

  it('rejects non-APPROVED brands', async () => {
    prisma.brandCandidate.findUnique.mockResolvedValue({
      ...candidate,
      status: BrandCandidateStatus.UNDER_REVIEW,
    });
    await expect(
      service.startBbcDiscovery({ brandCandidateIds: ['b1'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects unknown brand', async () => {
    prisma.brandCandidate.findUnique.mockResolvedValue(null);
    await expect(
      service.startBbcDiscovery({ brandCandidateIds: ['missing'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when a PROCESSING run already exists', async () => {
    prisma.leadDiscoveryRun.findFirst.mockResolvedValue({ id: 'busy' });
    await expect(
      service.startBbcDiscovery({ brandCandidateIds: ['b1'] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('marks run FAILED when enqueue throws (duplicate job / queue error)', async () => {
    queue.add.mockRejectedValue(new Error('Job already exists'));
    prisma.leadDiscoveryRun.update.mockResolvedValue({});

    await expect(
      service.startBbcDiscovery({ brandCandidateIds: ['b1'] }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.leadDiscoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-bbc-1' },
      data: expect.objectContaining({
        status: LeadDiscoveryStatus.FAILED,
        errorMessage: expect.stringContaining('BBC_ENQUEUE_FAILED'),
        searchMetadata: expect.anything(),
      }),
    });
  });

  it('documents queue name is contact-discovery not prospecting', () => {
    expect(QUEUES.CONTACT_DISCOVERY).toBe('contact-discovery');
    expect(QUEUES.CONTACT_DISCOVERY).not.toBe(QUEUES.PROSPECTING);
  });
});
