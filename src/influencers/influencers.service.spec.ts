import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { IbpStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { InfluencerSortBy, SortOrder } from './dto/query-influencers.dto';
import { InfluencersService, influencerSelect } from './influencers.service';

describe('InfluencersService', () => {
  let influencersService: InfluencersService;

  const prismaService = {
    influencer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockInfluencer = {
    id: 'influencer-id',
    name: 'Laura Martínez',
    instagram: '@laurafit_es',
    tiktok: null,
    youtube: null,
    country: 'ES',
    language: 'es',
    niche: 'Fitness',
    subNiche: 'Nutrición deportiva',
    followers: 180000,
    engagement: '4.50',
    email: 'laura@example.com',
    mediaKitUrl: null,
    idealBrandProfile: null,
    createdAt: new Date('2026-06-28T12:00:00.000Z'),
    updatedAt: new Date('2026-06-28T12:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InfluencersService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    influencersService = module.get<InfluencersService>(InfluencersService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated influencers with filters and sorting', async () => {
      prismaService.influencer.findMany.mockResolvedValue([mockInfluencer]);
      prismaService.influencer.count.mockResolvedValue(1);

      const result = await influencersService.findAll({
        page: 1,
        limit: 20,
        search: 'laura',
        country: 'ES',
        ibpStatus: IbpStatus.ACTIVE,
        sortBy: InfluencerSortBy.NAME,
        sortOrder: SortOrder.ASC,
      });

      expect(result).toEqual({
        data: [mockInfluencer],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      expect(prismaService.influencer.findMany).toHaveBeenCalledWith({
        where: {
          country: 'ES',
          idealBrandProfile: { status: IbpStatus.ACTIVE },
          OR: [
            { name: { contains: 'laura', mode: 'insensitive' } },
            { instagram: { contains: 'laura', mode: 'insensitive' } },
            { tiktok: { contains: 'laura', mode: 'insensitive' } },
            { youtube: { contains: 'laura', mode: 'insensitive' } },
            { email: { contains: 'laura', mode: 'insensitive' } },
          ],
        },
        select: influencerSelect,
        orderBy: { name: 'asc' },
        skip: 0,
        take: 20,
      });
    });
  });

  describe('findOne', () => {
    it('should return an influencer by id', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(mockInfluencer);

      await expect(
        influencersService.findOne('influencer-id'),
      ).resolves.toEqual(mockInfluencer);
    });

    it('should throw NotFoundException when influencer does not exist', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);

      await expect(influencersService.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create an influencer', async () => {
      prismaService.influencer.create.mockResolvedValue(mockInfluencer);

      const dto = {
        name: 'Laura Martínez',
        country: 'ES',
        followers: 180000,
        engagement: 4.5,
      };

      const result = await influencersService.create(dto);

      expect(prismaService.influencer.create).toHaveBeenCalled();
      expect(result).toEqual(mockInfluencer);
    });
  });

  describe('update', () => {
    it('should update influencer fields', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(mockInfluencer);
      prismaService.influencer.update.mockResolvedValue({
        ...mockInfluencer,
        name: 'Laura M.',
      });

      const result = await influencersService.update('influencer-id', {
        name: 'Laura M.',
      });

      expect(prismaService.influencer.update).toHaveBeenCalledWith({
        where: { id: 'influencer-id' },
        data: { name: 'Laura M.' },
        select: influencerSelect,
      });
      expect(result.name).toBe('Laura M.');
    });
  });

  describe('remove', () => {
    it('should delete an influencer', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(mockInfluencer);
      prismaService.influencer.delete.mockResolvedValue(mockInfluencer);

      await expect(influencersService.remove('influencer-id')).resolves.toEqual(
        {
          message: 'Influencer deleted successfully',
        },
      );

      expect(prismaService.influencer.delete).toHaveBeenCalledWith({
        where: { id: 'influencer-id' },
      });
    });
  });
});
