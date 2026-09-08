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
  LeadStatus,
} from '../generated/prisma/enums';
import { LeadDiscoveryService } from './lead-discovery.service';
import { LeadSourceRegistry } from './lead-source.registry';
import { MockLeadSource } from './providers/mock.lead-source';
import { computeOutreachReadiness } from './utils/outreach-readiness.util';

describe('LeadDiscoveryService', () => {
  const prisma = {
    brandCandidate: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
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

  const contactChannelService = {
    createChannelsForLead: jest.fn().mockResolvedValue(undefined),
    persistPublicEmailEnrichment: jest.fn().mockResolvedValue({
      channelsAdded: { linkedin: 0, website: 1, email: 0 },
      genericEmails: 0,
      nonGenericEmails: 0,
      pagesAttempted: 2,
      pagesSucceeded: 1,
      errors: 0,
    }),
    computeReadiness: jest.fn().mockReturnValue('PARTIAL'),
    addChannel: jest.fn(),
  };

  const publicEmailEvidence = {
    discoverForProfile: jest.fn().mockResolvedValue({
      candidates: [],
      summary: {
        website: 'https://acme.com',
        pagesAttempted: 2,
        pagesSucceeded: 1,
        emailsFound: 0,
        genericEmailsFound: 0,
        nonGenericEmailsFound: 0,
        errors: 0,
        pageResults: [],
      },
    }),
  };

  let service: LeadDiscoveryService;

  const leadRow = {
    id: 'l1',
    brandCandidateId: 'b1',
    influencerId: 'i1',
    runId: 'r1',
    contactName: 'Ada',
    title: 'CMO',
    email: 'ada@acme.com',
    emailConfidence: 'UNKNOWN',
    isGeneric: false,
    profileUrl: null,
    providerId: 'brightdata',
    sourceOptionId: null,
    fitReason: null,
    source: 'test',
    status: LeadStatus.APPROVED,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    brandCandidate: { id: 'b1', name: 'Acme' },
    influencer: { id: 'i1', name: 'Inf' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    service = new LeadDiscoveryService(
      prisma as never,
      configService,
      registry,
      aiPromptsService as never,
      contactChannelService as never,
      publicEmailEvidence as never,
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

  describe('selectLeadForOutreach', () => {
    it('selects an APPROVED lead and sets selectedLeadId', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
        status: LeadStatus.APPROVED,
      });
      prisma.brandCandidate.update.mockResolvedValue({
        id: 'b1',
        selectedLeadId: 'l1',
      });
      prisma.lead.findUniqueOrThrow.mockResolvedValue(leadRow);

      const result = await service.selectLeadForOutreach('l1');

      expect(prisma.brandCandidate.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { selectedLeadId: 'l1' },
      });
      expect(result.selectedForOutreach).toBe(true);
      expect(result.id).toBe('l1');
    });

    it('rejects UNDER_REVIEW', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
        status: LeadStatus.UNDER_REVIEW,
      });

      await expect(service.selectLeadForOutreach('l1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.brandCandidate.update).not.toHaveBeenCalled();
    });

    it('rejects DISCARDED', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
        status: LeadStatus.DISCARDED,
      });

      await expect(service.selectLeadForOutreach('l1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects DUPLICATE', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
        status: LeadStatus.DUPLICATE,
      });

      await expect(service.selectLeadForOutreach('l1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects missing lead', async () => {
      prisma.lead.findUnique.mockResolvedValue(null);

      await expect(
        service.selectLeadForOutreach('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('replaces previous selection when selecting another lead', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l2',
        brandCandidateId: 'b1',
        status: LeadStatus.APPROVED,
      });
      prisma.brandCandidate.update.mockResolvedValue({
        id: 'b1',
        selectedLeadId: 'l2',
      });
      prisma.lead.findUniqueOrThrow.mockResolvedValue({
        ...leadRow,
        id: 'l2',
      });

      const result = await service.selectLeadForOutreach('l2');

      expect(prisma.brandCandidate.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { selectedLeadId: 'l2' },
      });
      expect(result.id).toBe('l2');
      expect(result.selectedForOutreach).toBe(true);
    });
  });

  describe('deselectLeadForOutreach', () => {
    it('clears selectedLeadId when lead is currently selected', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
        brandCandidate: { selectedLeadId: 'l1' },
      });
      prisma.brandCandidate.update.mockResolvedValue({
        id: 'b1',
        selectedLeadId: null,
      });
      prisma.lead.findUniqueOrThrow.mockResolvedValue(leadRow);

      const result = await service.deselectLeadForOutreach('l1');

      expect(prisma.brandCandidate.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { selectedLeadId: null },
      });
      expect(result.selectedForOutreach).toBe(false);
    });

    it('rejects deselect when lead is not selected', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
        brandCandidate: { selectedLeadId: 'l2' },
      });

      await expect(
        service.deselectLeadForOutreach('l1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.brandCandidate.update).not.toHaveBeenCalled();
    });

    it('rejects missing lead on deselect', async () => {
      prisma.lead.findUnique.mockResolvedValue(null);

      await expect(
        service.deselectLeadForOutreach('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateLeadStatus selection cleanup', () => {
    it('clears selection when selected lead is DISCARDED', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
      });
      prisma.lead.update.mockResolvedValue({
        ...leadRow,
        status: LeadStatus.DISCARDED,
      });
      prisma.brandCandidate.updateMany.mockResolvedValue({ count: 1 });
      prisma.brandCandidate.findMany.mockResolvedValue([
        { id: 'b1', selectedLeadId: null },
      ]);

      const updated = await service.updateLeadStatus('l1', {
        status: LeadStatus.DISCARDED,
      });

      expect(prisma.brandCandidate.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', selectedLeadId: 'l1' },
        data: { selectedLeadId: null },
      });
      expect(updated.status).toBe(LeadStatus.DISCARDED);
      expect(updated.selectedForOutreach).toBe(false);
    });

    it('clears selection when selected lead is DUPLICATE', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
      });
      prisma.lead.update.mockResolvedValue({
        ...leadRow,
        status: LeadStatus.DUPLICATE,
      });
      prisma.brandCandidate.updateMany.mockResolvedValue({ count: 1 });
      prisma.brandCandidate.findMany.mockResolvedValue([
        { id: 'b1', selectedLeadId: null },
      ]);

      await service.updateLeadStatus('l1', { status: LeadStatus.DUPLICATE });

      expect(prisma.brandCandidate.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', selectedLeadId: 'l1' },
        data: { selectedLeadId: null },
      });
    });

    it('does not clear when approving (updateMany not for APPROVED)', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
      });
      prisma.lead.update.mockResolvedValue(leadRow);
      prisma.brandCandidate.findMany.mockResolvedValue([
        { id: 'b1', selectedLeadId: 'l1' },
      ]);

      const updated = await service.updateLeadStatus('l1', {
        status: LeadStatus.APPROVED,
      });

      expect(prisma.brandCandidate.updateMany).not.toHaveBeenCalled();
      expect(updated.selectedForOutreach).toBe(true);
    });

    it('DISCARDED on non-selected lead still calls updateMany with lead id (no-op if not selected)', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l2',
        brandCandidateId: 'b1',
      });
      prisma.lead.update.mockResolvedValue({
        ...leadRow,
        id: 'l2',
        status: LeadStatus.DISCARDED,
      });
      prisma.brandCandidate.updateMany.mockResolvedValue({ count: 0 });
      prisma.brandCandidate.findMany.mockResolvedValue([
        { id: 'b1', selectedLeadId: 'l1' },
      ]);

      const updated = await service.updateLeadStatus('l2', {
        status: LeadStatus.DISCARDED,
      });

      expect(prisma.brandCandidate.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', selectedLeadId: 'l2' },
        data: { selectedLeadId: null },
      });
      expect(updated.selectedForOutreach).toBe(false);
    });
  });

  describe('listLeads selectedForOutreach', () => {
    it('marks the selected lead', async () => {
      prisma.lead.findMany.mockResolvedValue([
        { ...leadRow, id: 'l1' },
        { ...leadRow, id: 'l2' },
      ]);
      prisma.brandCandidate.findMany.mockResolvedValue([
        { id: 'b1', selectedLeadId: 'l2' },
      ]);

      const leads = await service.listLeads({ brandCandidateId: 'b1' });

      expect(leads.find((l) => l.id === 'l1')?.selectedForOutreach).toBe(false);
      expect(leads.find((l) => l.id === 'l2')?.selectedForOutreach).toBe(true);
    });
  });

  describe('executeDiscovery public email enrichment (D2)', () => {
    const runRow = {
      id: 'run1',
      brandCandidateId: 'b1',
      influencerId: 'i1',
      providerId: 'brightdata',
      providerOptions: { optionIds: ['gd_me5ppxjr2ge6icjuh0'] },
      limit: 2,
      status: LeadDiscoveryStatus.PROCESSING,
      brandCandidate: {
        id: 'b1',
        name: 'Acme',
        website: 'https://acme.com',
        domain: 'acme.com',
        status: BrandCandidateStatus.APPROVED,
      },
    };

    beforeEach(() => {
      prisma.leadDiscoveryRun.findUnique.mockResolvedValue(runRow);
      prisma.lead.findMany.mockResolvedValue([]);
      prisma.lead.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: `lead-${data.contactName}`,
          ...data,
        }),
      );
      prisma.leadDiscoveryRun.update.mockResolvedValue({
        ...runRow,
        status: LeadDiscoveryStatus.COMPLETED,
      });
    });

    it('enriches leads after creation and marks run completed', async () => {
      await service.executeDiscovery('run1');

      expect(prisma.lead.create).toHaveBeenCalled();
      expect(publicEmailEvidence.discoverForProfile).toHaveBeenCalled();
      expect(contactChannelService.persistPublicEmailEnrichment).toHaveBeenCalled();
      expect(prisma.leadDiscoveryRun.update).toHaveBeenCalledWith({
        where: { id: 'run1' },
        data: {
          status: LeadDiscoveryStatus.COMPLETED,
          errorMessage: null,
        },
      });
    });

    it('keeps lead when public email enrichment fails', async () => {
      publicEmailEvidence.discoverForProfile.mockRejectedValueOnce(
        new Error('unlocker timeout'),
      );

      await service.executeDiscovery('run1');

      expect(prisma.lead.create).toHaveBeenCalled();
      expect(prisma.leadDiscoveryRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LeadDiscoveryStatus.COMPLETED,
          }),
        }),
      );
    });

    it('does not activate READY outreach readiness during D2', () => {
      expect(computeOutreachReadiness([])).toBe('LIMITED');
      expect(
        computeOutreachReadiness([
          {
            id: 'c1',
            leadId: 'l1',
            type: 'EMAIL',
            value: 'info@acme.com',
            status: 'ACTIVE',
            source: 'PUBLIC_WEB',
            sourceUrl: 'https://acme.com',
            isGeneric: true,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ] as never),
      ).toBe('PARTIAL');
    });
  });
});
