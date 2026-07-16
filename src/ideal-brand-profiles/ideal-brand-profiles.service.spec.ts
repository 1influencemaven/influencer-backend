import { ConflictException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AiPromptsService } from '../ai-prompts/ai-prompts.service';
import { AI_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import { IbpStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  idealBrandProfileSelect,
  IdealBrandProfilesService,
} from './ideal-brand-profiles.service';

describe('IdealBrandProfilesService', () => {
  let service: IdealBrandProfilesService;

  const prismaService = {
    influencer: {
      findUnique: jest.fn(),
    },
    idealBrandProfile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };

  const aiPromptsService = {
    getIbpInstructions: jest.fn(),
  };

  const aiQueue = {
    add: jest.fn(),
  };

  const mockProfile = {
    id: 'ibp-id',
    influencerId: 'influencer-id',
    status: IbpStatus.DRAFT,
    targetSectors: ['sportswear'],
    excludedSectors: ['alcohol'],
    brandSize: ['smb'],
    markets: ['Spain'],
    collaborationTypes: ['product launch'],
    summary: 'Healthy lifestyle brands in Spain.',
    alertSignals: [],
    desirableCriteria: ['sustainability'],
    metadata: { lastGeneratedAt: '2026-07-11T12:00:00.000Z' },
    createdAt: new Date('2026-07-11T12:00:00.000Z'),
    updatedAt: new Date('2026-07-11T12:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdealBrandProfilesService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AiPromptsService, useValue: aiPromptsService },
        { provide: getQueueToken(QUEUES.AI), useValue: aiQueue },
      ],
    }).compile();

    service = module.get<IdealBrandProfilesService>(IdealBrandProfilesService);
    jest.clearAllMocks();
    aiPromptsService.getIbpInstructions.mockResolvedValue(
      'Custom IBP instructions',
    );
  });

  describe('generate', () => {
    it('should enqueue IBP generation job with prompt snapshot', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        id: 'influencer-id',
      });
      prismaService.idealBrandProfile.findUnique.mockResolvedValue(null);
      prismaService.idealBrandProfile.upsert.mockResolvedValue(mockProfile);
      aiQueue.add.mockResolvedValue(undefined);

      const result = await service.generate('influencer-id');

      expect(prismaService.idealBrandProfile.upsert).toHaveBeenCalled();
      expect(aiPromptsService.getIbpInstructions).toHaveBeenCalled();
      expect(aiQueue.add).toHaveBeenCalledWith(
        AI_JOBS.GENERATE_IDEAL_BRAND_PROFILE,
        {
          influencerId: 'influencer-id',
          promptInstructions: 'Custom IBP instructions',
        },
      );
      expect(result.status).toBe(IbpStatus.PROCESSING);
    });

    it('should throw ConflictException when already processing', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        id: 'influencer-id',
      });
      prismaService.idealBrandProfile.findUnique.mockResolvedValue({
        status: IbpStatus.PROCESSING,
      });

      await expect(service.generate('influencer-id')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('save', () => {
    it('should save edits and mark profile as ACTIVE', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        id: 'influencer-id',
      });
      prismaService.idealBrandProfile.findUnique.mockResolvedValue({
        status: IbpStatus.DRAFT,
      });
      prismaService.idealBrandProfile.update.mockResolvedValue({
        ...mockProfile,
        status: IbpStatus.ACTIVE,
      });

      const dto = {
        targetSectors: ['sportswear'],
        excludedSectors: ['alcohol'],
        brandSize: ['smb'],
        markets: ['Spain'],
        collaborationTypes: ['product launch'],
        summary: 'Updated summary',
        alertSignals: [],
        desirableCriteria: ['sustainability'],
      };

      const result = await service.save('influencer-id', dto);

      expect(prismaService.idealBrandProfile.update).toHaveBeenCalledWith({
        where: { influencerId: 'influencer-id' },
        data: { ...dto, status: IbpStatus.ACTIVE },
        select: idealBrandProfileSelect,
      });
      expect(result.status).toBe(IbpStatus.ACTIVE);
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        id: 'influencer-id',
      });
      prismaService.idealBrandProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.save('influencer-id', {
          targetSectors: ['sportswear'],
          excludedSectors: [],
          brandSize: ['smb'],
          markets: ['Spain'],
          collaborationTypes: ['product launch'],
          summary: 'Summary',
          alertSignals: [],
          desirableCriteria: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
