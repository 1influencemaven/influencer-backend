jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { LeadStatus } from '../generated/prisma/enums';
import {
  BBC_BRIGHTDATA_PROVIDER_ID,
  MASTRA_CONTACT_EMAILS_PROVIDER_ID,
} from '../contact-discovery/constants';
import { LeadDiscoveryService } from './lead-discovery.service';

describe('LeadDiscoveryService', () => {
  const prisma = {
    brandCandidate: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    leadDiscoveryRun: {
      findMany: jest.fn(),
    },
    lead: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const contactChannelService = {
    computeReadiness: jest.fn().mockReturnValue('PARTIAL'),
    addChannel: jest.fn(),
  };

  const contactDiscoveryService = {
    startBbcDiscovery: jest.fn(),
  };

  let service: LeadDiscoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadDiscoveryService(
      prisma as never,
      contactChannelService as never,
      contactDiscoveryService as never,
    );
  });

  it('lists Mastra as default write provider (Paso 5b)', () => {
    expect(service.listProviders()).toEqual({
      available: [
        MASTRA_CONTACT_EMAILS_PROVIDER_ID,
        BBC_BRIGHTDATA_PROVIDER_ID,
      ],
      default: MASTRA_CONTACT_EMAILS_PROVIDER_ID,
      rebuildMode: true,
    });
  });

  it('lists Mastra provider options', () => {
    expect(service.listProviderOptions(MASTRA_CONTACT_EMAILS_PROVIDER_ID)).toEqual(
      expect.objectContaining({
        providerId: MASTRA_CONTACT_EMAILS_PROVIDER_ID,
        mode: 'mastra-find-brand-emails',
        autonomous: true,
      }),
    );
  });

  it('delegates search to ContactDiscoveryService (Mastra enqueue)', async () => {
    contactDiscoveryService.startBbcDiscovery.mockResolvedValue({
      message: 'Contact discovery BBC jobs enqueued',
      runs: [{ id: 'run-1' }],
    });

    const result = await service.search({
      brandCandidateIds: ['b1'],
      limit: 5,
    });

    expect(contactDiscoveryService.startBbcDiscovery).toHaveBeenCalledWith({
      brandCandidateIds: ['b1'],
      limit: 5,
    });
    expect(result.runs).toHaveLength(1);
  });

  describe('selectLeadForOutreach', () => {
    it('selects an APPROVED lead and sets selectedLeadId', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
        status: LeadStatus.APPROVED,
      });
      prisma.brandCandidate.update.mockResolvedValue({});
      prisma.lead.findUniqueOrThrow.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
      });

      const result = await service.selectLeadForOutreach('l1');

      expect(prisma.brandCandidate.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { selectedLeadId: 'l1' },
      });
      expect(result.selectedForOutreach).toBe(true);
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
    });

    it('rejects missing lead', async () => {
      prisma.lead.findUnique.mockResolvedValue(null);
      await expect(service.selectLeadForOutreach('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deselectLeadForOutreach', () => {
    it('clears selectedLeadId when lead is currently selected', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
        brandCandidate: { selectedLeadId: 'l1' },
      });
      prisma.brandCandidate.update.mockResolvedValue({});
      prisma.lead.findUniqueOrThrow.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
      });

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
        brandCandidate: { selectedLeadId: 'other' },
      });
      await expect(service.deselectLeadForOutreach('l1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('updateLeadStatus selection cleanup', () => {
    it('clears selection when selected lead is DISCARDED', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'l1',
        brandCandidateId: 'b1',
      });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          lead: {
            update: jest.fn().mockResolvedValue({
              id: 'l1',
              brandCandidateId: 'b1',
            }),
          },
          brandCandidate: {
            updateMany: prisma.brandCandidate.updateMany,
          },
        }),
      );
      prisma.brandCandidate.findMany.mockResolvedValue([
        { id: 'b1', selectedLeadId: null },
      ]);

      await service.updateLeadStatus('l1', { status: LeadStatus.DISCARDED });

      expect(prisma.brandCandidate.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', selectedLeadId: 'l1' },
        data: { selectedLeadId: null },
      });
    });
  });

  describe('listLeads selectedForOutreach', () => {
    it('marks the selected lead', async () => {
      prisma.lead.findMany.mockResolvedValue([
        { id: 'l1', brandCandidateId: 'b1' },
        { id: 'l2', brandCandidateId: 'b1' },
      ]);
      prisma.brandCandidate.findMany.mockResolvedValue([
        { id: 'b1', selectedLeadId: 'l1' },
      ]);

      const leads = await service.listLeads({ brandCandidateId: 'b1' });

      expect(leads[0].selectedForOutreach).toBe(true);
      expect(leads[1].selectedForOutreach).toBe(false);
    });
  });
});
