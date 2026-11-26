import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import {
  IbpStatus,
  InfluencerDataOrigin,
  InfluencerQuarter,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { InfluencerSortBy, SortOrder } from './dto/query-influencers.dto';
import {
  InfluencersService,
  influencerDetailSelect,
  influencerSelect,
} from './influencers.service';
import { INFLUENCER_FIELD_KEYS } from './utils/influencer-field-keys';

describe('InfluencersService', () => {
  let influencersService: InfluencersService;

  const tx = {
    influencer: {
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    influencerFieldProvenance: {
      upsert: jest.fn(),
    },
    influencerQuarterAssignment: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };

  const prismaService = {
    influencer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockInfluencer = {
    id: 'influencer-id',
    name: 'Laura Martínez',
    instagram: '@laurafit_es',
    instagramNormalized: 'laurafit_es',
    tiktok: null,
    youtube: null,
    countries: ['ES'],
    language: 'es',
    niche: 'Fitness',
    subNiche: 'Nutrición deportiva',
    niches: ['Fitness'],
    followers: 180000,
    engagement: '4.50',
    email: 'laura@example.com',
    outgoingEmail: null,
    mediaKitUrl: null,
    managerId: null,
    manager: null,
    quarterAssignments: [],
    fieldProvenances: [],
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

    prismaService.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => unknown) => fn(tx),
    );
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
          countries: { has: 'ES' },
          idealBrandProfile: { status: IbpStatus.ACTIVE },
          OR: [
            { name: { contains: 'laura', mode: 'insensitive' } },
            { instagram: { contains: 'laura', mode: 'insensitive' } },
            {
              instagramNormalized: {
                contains: 'laura',
                mode: 'insensitive',
              },
            },
            { tiktok: { contains: 'laura', mode: 'insensitive' } },
            { youtube: { contains: 'laura', mode: 'insensitive' } },
            { email: { contains: 'laura', mode: 'insensitive' } },
            { outgoingEmail: { contains: 'laura', mode: 'insensitive' } },
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
    it('should return an influencer by id with detail select', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(mockInfluencer);

      await expect(
        influencersService.findOne('influencer-id'),
      ).resolves.toEqual(mockInfluencer);

      expect(prismaService.influencer.findUnique).toHaveBeenCalledWith({
        where: { id: 'influencer-id' },
        select: influencerDetailSelect,
      });
    });

    it('should throw NotFoundException when influencer does not exist', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);

      await expect(influencersService.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should normalize Instagram, persist niches/quarters, and mark MANUAL provenance', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);
      prismaService.user.findUnique.mockResolvedValue({ id: 'manager-1' });
      tx.influencer.create.mockResolvedValue({ id: 'influencer-id' });
      tx.influencerFieldProvenance.upsert.mockResolvedValue({});
      tx.influencer.findUniqueOrThrow.mockResolvedValue({
        ...mockInfluencer,
        niches: ['Fitness', 'Lifestyle'],
        managerId: 'manager-1',
        outgoingEmail: 'out@agency.com',
        quarterAssignments: [
          { id: 'q1', year: 2026, quarter: InfluencerQuarter.Q1, assignedAt: new Date() },
          { id: 'q2', year: 2025, quarter: InfluencerQuarter.Q4, assignedAt: new Date() },
        ],
      });

      const dto = {
        name: 'Laura Martínez',
        instagram: 'https://www.instagram.com/LauraFit_ES/',
        countries: ['ES'],
        niches: ['Fitness', 'Lifestyle', 'fitness'],
        managerId: 'manager-1',
        email: 'laura@example.com',
        outgoingEmail: 'out@agency.com',
        quarters: [
          { year: 2026, quarter: InfluencerQuarter.Q1 },
          { year: 2025, quarter: InfluencerQuarter.Q4 },
        ],
      };

      const result = await influencersService.create(dto);

      expect(tx.influencer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Laura Martínez',
            instagram: '@laurafit_es',
            instagramNormalized: 'laurafit_es',
            niches: ['Fitness', 'Lifestyle'],
            email: 'laura@example.com',
            outgoingEmail: 'out@agency.com',
            managerId: 'manager-1',
            quarterAssignments: {
              create: [
                { year: 2026, quarter: InfluencerQuarter.Q1 },
                { year: 2025, quarter: InfluencerQuarter.Q4 },
              ],
            },
          }),
        }),
      );

      expect(tx.influencerFieldProvenance.upsert).toHaveBeenCalled();
      expect(result.instagramNormalized).toBe('laurafit_es');
      expect(result.outgoingEmail).toBe('out@agency.com');
      expect(result.email).toBe('laura@example.com');
    });

    it('should persist the validated managerId when the manager user exists', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);
      prismaService.user.findUnique.mockResolvedValue({ id: 'manager-1' });
      tx.influencer.create.mockResolvedValue({ id: 'influencer-id' });
      tx.influencerFieldProvenance.upsert.mockResolvedValue({});
      tx.influencer.findUniqueOrThrow.mockResolvedValue({
        ...mockInfluencer,
        managerId: 'manager-1',
      });

      await influencersService.create({
        name: 'Laura Martínez',
        instagram: '@laurafit_es',
        countries: ['ES'],
        managerId: '  manager-1  ',
      });

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'manager-1' },
        select: { id: true },
      });
      expect(tx.influencer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            managerId: 'manager-1',
          }),
        }),
      );
    });

    it('should persist Instagram research evidence and EXTERNAL followers/email on create', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);
      prismaService.user.findUnique.mockResolvedValue({ id: 'manager-1' });
      tx.influencer.create.mockResolvedValue({ id: 'influencer-id' });
      tx.influencerFieldProvenance.upsert.mockResolvedValue({});
      tx.influencer.findUniqueOrThrow.mockResolvedValue({
        ...mockInfluencer,
        followers: 10232,
        email: 'contact@example.com',
        managerId: 'manager-1',
        instagramResearchEvidence: { version: 1 },
      });

      const fetchedAt = '2026-11-13T20:00:00.000Z';
      await influencersService.create({
        name: 'PIXEL SPARTAN',
        instagram: '@pixel.vnzla',
        countries: ['ES'],
        managerId: 'manager-1',
        niches: [],
        instagramResearch: {
          source: 'brightdata:instagram:gd_x',
          fetchedAt,
          handleNormalized: 'pixel.vnzla',
          profileUrl: 'https://www.instagram.com/pixel.vnzla/',
          normalized: {
            account: 'pixel.vnzla',
            displayName: 'PIXEL SPARTAN',
            biography: 'Bio for Mastra',
            followers: 10232,
            following: 2244,
            postsCount: 583,
            isPrivate: false,
            isVerified: false,
            emailAddress: 'contact@example.com',
            profileImageUrl: null,
            profileUrl: 'https://www.instagram.com/pixel.vnzla/',
            externalUrls: [],
            bioHashtags: ['venezuela'],
            postHashtags: ['dancehall'],
          },
        },
      });

      expect(tx.influencer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            followers: 10232,
            email: 'contact@example.com',
            niches: [],
            instagramResearchEvidence: expect.objectContaining({
              version: 1,
              handleNormalized: 'pixel.vnzla',
              normalized: expect.objectContaining({
                biography: 'Bio for Mastra',
                bioHashtags: ['venezuela'],
                postHashtags: ['dancehall'],
                followers: 10232,
              }),
            }),
          }),
        }),
      );

      const provenanceCalls = tx.influencerFieldProvenance.upsert.mock.calls.map(
        (call) => call[0],
      );
      const followersProv = provenanceCalls.find(
        (row) => row.create.fieldKey === INFLUENCER_FIELD_KEYS.FOLLOWERS,
      );
      const emailProv = provenanceCalls.find(
        (row) => row.create.fieldKey === INFLUENCER_FIELD_KEYS.EMAIL,
      );
      const nameProv = provenanceCalls.find(
        (row) => row.create.fieldKey === INFLUENCER_FIELD_KEYS.NAME,
      );

      expect(followersProv?.create.origin).toBe(InfluencerDataOrigin.EXTERNAL);
      expect(followersProv?.create.source).toBe('brightdata:instagram:gd_x');
      expect(emailProv?.create.origin).toBe(InfluencerDataOrigin.EXTERNAL);
      expect(nameProv?.create.origin).toBe(InfluencerDataOrigin.MANUAL);
    });

    it('should keep explicit DTO followers as MANUAL and still store research evidence', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);
      prismaService.user.findUnique.mockResolvedValue({ id: 'manager-1' });
      tx.influencer.create.mockResolvedValue({ id: 'influencer-id' });
      tx.influencerFieldProvenance.upsert.mockResolvedValue({});
      tx.influencer.findUniqueOrThrow.mockResolvedValue(mockInfluencer);

      await influencersService.create({
        name: 'Laura Martínez',
        instagram: '@laurafit_es',
        countries: ['ES'],
        managerId: 'manager-1',
        followers: 1,
        instagramResearch: {
          source: 'brightdata:instagram:gd_x',
          fetchedAt: '2026-11-13T20:00:00.000Z',
          handleNormalized: 'laurafit_es',
          profileUrl: 'https://www.instagram.com/laurafit_es/',
          normalized: {
            followers: 999,
            emailAddress: null,
            biography: 'x',
            account: 'laurafit_es',
            displayName: null,
            following: null,
            postsCount: null,
            isPrivate: false,
            isVerified: false,
            profileImageUrl: null,
            profileUrl: null,
            externalUrls: [],
            bioHashtags: [],
            postHashtags: [],
          },
        },
      });

      expect(tx.influencer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            followers: 1,
            instagramResearchEvidence: expect.objectContaining({
              normalized: expect.objectContaining({ followers: 999 }),
            }),
          }),
        }),
      );

      const followersProv = tx.influencerFieldProvenance.upsert.mock.calls
        .map((call) => call[0])
        .find((row) => row.create.fieldKey === INFLUENCER_FIELD_KEYS.FOLLOWERS);
      expect(followersProv?.create.origin).toBe(InfluencerDataOrigin.MANUAL);
    });

    it('should reject create when managerId is missing', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);

      await expect(
        influencersService.create({
          name: 'Laura Martínez',
          instagram: '@laurafit_es',
        countries: ['ES'],
        } as Parameters<InfluencersService['create']>[0]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tx.influencer.create).not.toHaveBeenCalled();
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should reject create when managerId is null', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);

      await expect(
        influencersService.create({
          name: 'Laura Martínez',
          instagram: '@laurafit_es',
        countries: ['ES'],
          managerId: null,
        } as unknown as Parameters<InfluencersService['create']>[0]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tx.influencer.create).not.toHaveBeenCalled();
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should reject create when managerId is an empty string', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);

      await expect(
        influencersService.create({
          name: 'Laura Martínez',
          instagram: '@laurafit_es',
        countries: ['ES'],
          managerId: '',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tx.influencer.create).not.toHaveBeenCalled();
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should reject create when managerId does not match an existing user', async () => {
      prismaService.influencer.findUnique.mockResolvedValue(null);
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        influencersService.create({
          name: 'Laura Martínez',
          instagram: '@laurafit_es',
        countries: ['ES'],
          managerId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: '550e8400-e29b-41d4-a716-446655440000' },
        select: { id: true },
      });
      expect(tx.influencer.create).not.toHaveBeenCalled();
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should reject duplicate Instagram via instagramNormalized', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        id: 'other-id',
      });

      await expect(
        influencersService.create({
          name: 'Other',
          instagram: '@laurafit_es',
        countries: ['ES'],
          managerId: 'manager-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(tx.influencer.create).not.toHaveBeenCalled();
    });

    it('should reject invalid Instagram handles', async () => {
      await expect(
        influencersService.create({
          name: 'Bad',
          instagram: 'not a handle!!!',
        countries: ['ES'],
          managerId: 'manager-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tx.influencer.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update niches and manager without touching untouched provenance fields', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        ...mockInfluencer,
        fieldProvenances: [
          {
            fieldKey: INFLUENCER_FIELD_KEYS.EMAIL,
            origin: InfluencerDataOrigin.LEGACY,
          },
        ],
      });
      prismaService.user.findUnique.mockResolvedValue({ id: 'manager-1' });

      tx.influencer.update.mockResolvedValue({});
      tx.influencerQuarterAssignment.findMany.mockResolvedValue([]);
      tx.influencerQuarterAssignment.createMany.mockResolvedValue({ count: 1 });
      tx.influencerFieldProvenance.upsert.mockResolvedValue({});
      tx.influencer.findUniqueOrThrow.mockResolvedValue({
        ...mockInfluencer,
        niches: ['Beauty'],
        managerId: 'manager-1',
        outgoingEmail: 'send@agency.com',
      });

      const result = await influencersService.update('influencer-id', {
        niches: ['Beauty'],
        managerId: 'manager-1',
        outgoingEmail: 'send@agency.com',
        quarters: [{ year: 2026, quarter: InfluencerQuarter.Q2 }],
      });

      expect(tx.influencer.update).toHaveBeenCalledWith({
        where: { id: 'influencer-id' },
        data: expect.objectContaining({
          niches: ['Beauty'],
          outgoingEmail: 'send@agency.com',
          manager: { connect: { id: 'manager-1' } },
        }),
      });

      expect(tx.influencerQuarterAssignment.createMany).toHaveBeenCalledWith({
        data: [
          {
            influencerId: 'influencer-id',
            year: 2026,
            quarter: InfluencerQuarter.Q2,
          },
        ],
      });

      const provenanceKeys = tx.influencerFieldProvenance.upsert.mock.calls.map(
        (call) => call[0].create.fieldKey,
      );
      expect(provenanceKeys).toEqual(
        expect.arrayContaining([
          INFLUENCER_FIELD_KEYS.NICHES,
          INFLUENCER_FIELD_KEYS.MANAGER_ID,
          INFLUENCER_FIELD_KEYS.OUTGOING_EMAIL,
        ]),
      );
      expect(provenanceKeys).not.toContain(INFLUENCER_FIELD_KEYS.EMAIL);
      expect(result.niches).toEqual(['Beauty']);
    });

    it('should sync quarters without duplicating existing year+quarter pairs', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        ...mockInfluencer,
        fieldProvenances: [],
      });

      tx.influencer.update.mockResolvedValue({});
      tx.influencerQuarterAssignment.findMany.mockResolvedValue([
        {
          id: 'existing-q1',
          year: 2026,
          quarter: InfluencerQuarter.Q1,
        },
      ]);
      tx.influencerQuarterAssignment.createMany.mockResolvedValue({ count: 1 });
      tx.influencer.findUniqueOrThrow.mockResolvedValue(mockInfluencer);

      await influencersService.update('influencer-id', {
        quarters: [
          { year: 2026, quarter: InfluencerQuarter.Q1 },
          { year: 2026, quarter: InfluencerQuarter.Q3 },
        ],
      });

      expect(tx.influencerQuarterAssignment.deleteMany).not.toHaveBeenCalled();
      expect(tx.influencerQuarterAssignment.createMany).toHaveBeenCalledWith({
        data: [
          {
            influencerId: 'influencer-id',
            year: 2026,
            quarter: InfluencerQuarter.Q3,
          },
        ],
      });
    });

    it('should preserve historical quarters when payload omits an existing assignment', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        ...mockInfluencer,
        fieldProvenances: [],
      });

      tx.influencer.update.mockResolvedValue({});
      tx.influencerQuarterAssignment.findMany.mockResolvedValue([
        {
          id: 'existing-q1',
          year: 2026,
          quarter: InfluencerQuarter.Q1,
        },
        {
          id: 'existing-q2',
          year: 2025,
          quarter: InfluencerQuarter.Q4,
        },
      ]);
      tx.influencerQuarterAssignment.createMany.mockResolvedValue({ count: 1 });
      tx.influencer.findUniqueOrThrow.mockResolvedValue(mockInfluencer);

      await influencersService.update('influencer-id', {
        quarters: [{ year: 2026, quarter: InfluencerQuarter.Q2 }],
      });

      expect(tx.influencerQuarterAssignment.deleteMany).not.toHaveBeenCalled();
      expect(tx.influencerQuarterAssignment.createMany).toHaveBeenCalledWith({
        data: [
          {
            influencerId: 'influencer-id',
            year: 2026,
            quarter: InfluencerQuarter.Q2,
          },
        ],
      });
    });

    it('should not touch quarter assignments when updating other fields only', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        ...mockInfluencer,
        fieldProvenances: [],
      });

      tx.influencer.update.mockResolvedValue({});
      tx.influencerFieldProvenance.upsert.mockResolvedValue({});
      tx.influencer.findUniqueOrThrow.mockResolvedValue(mockInfluencer);

      await influencersService.update('influencer-id', {
        name: 'Laura Updated',
      });

      expect(tx.influencerQuarterAssignment.findMany).not.toHaveBeenCalled();
      expect(tx.influencerQuarterAssignment.createMany).not.toHaveBeenCalled();
      expect(tx.influencerQuarterAssignment.deleteMany).not.toHaveBeenCalled();
    });

    it('should keep email and outgoingEmail independent', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        ...mockInfluencer,
        email: 'legacy@example.com',
        outgoingEmail: null,
        fieldProvenances: [],
      });

      tx.influencer.update.mockResolvedValue({});
      tx.influencerFieldProvenance.upsert.mockResolvedValue({});
      tx.influencer.findUniqueOrThrow.mockResolvedValue({
        ...mockInfluencer,
        email: 'legacy@example.com',
        outgoingEmail: 'new-out@agency.com',
      });

      await influencersService.update('influencer-id', {
        outgoingEmail: 'new-out@agency.com',
      });

      expect(tx.influencer.update).toHaveBeenCalledWith({
        where: { id: 'influencer-id' },
        data: { outgoingEmail: 'new-out@agency.com' },
      });
    });

    it('should allow disconnecting manager with managerId null on update', async () => {
      prismaService.influencer.findUnique.mockResolvedValue({
        ...mockInfluencer,
        managerId: 'manager-1',
        fieldProvenances: [],
      });

      tx.influencer.update.mockResolvedValue({});
      tx.influencerFieldProvenance.upsert.mockResolvedValue({});
      tx.influencer.findUniqueOrThrow.mockResolvedValue({
        ...mockInfluencer,
        managerId: null,
        manager: null,
      });

      await influencersService.update('influencer-id', {
        managerId: null,
      });

      expect(tx.influencer.update).toHaveBeenCalledWith({
        where: { id: 'influencer-id' },
        data: expect.objectContaining({
          manager: { disconnect: true },
        }),
      });
      expect(prismaService.$transaction).toHaveBeenCalled();
    });
  });

  describe('planExternalFieldMerge', () => {
    it('preserves MANUAL values and omitted external fields', () => {
      const plan = influencersService.planExternalFieldMerge({
        currentValues: {
          [INFLUENCER_FIELD_KEYS.EMAIL]: 'manual@example.com',
          [INFLUENCER_FIELD_KEYS.FOLLOWERS]: 100,
          [INFLUENCER_FIELD_KEYS.ENGAGEMENT]: 3.2,
        },
        provenances: [
          {
            fieldKey: INFLUENCER_FIELD_KEYS.EMAIL,
            origin: InfluencerDataOrigin.MANUAL,
          },
          {
            fieldKey: INFLUENCER_FIELD_KEYS.FOLLOWERS,
            origin: InfluencerDataOrigin.EXTERNAL,
          },
        ],
        candidates: [
          {
            fieldKey: INFLUENCER_FIELD_KEYS.EMAIL,
            value: 'scraped@example.com',
          },
          {
            fieldKey: INFLUENCER_FIELD_KEYS.FOLLOWERS,
            value: undefined,
          },
          {
            fieldKey: INFLUENCER_FIELD_KEYS.ENGAGEMENT,
            value: 4.1,
          },
        ],
      });

      expect(plan.patch).toEqual({
        [INFLUENCER_FIELD_KEYS.ENGAGEMENT]: 4.1,
      });
      expect(plan.provenanceKeys).toEqual([INFLUENCER_FIELD_KEYS.ENGAGEMENT]);
    });
  });

  describe('findEligibleManagers', () => {
    it('lists existing users without hardcoding names', async () => {
      const users = [
        {
          id: 'u1',
          name: 'Ana',
          email: 'ana@example.com',
          role: 'ADMIN',
        },
      ];
      prismaService.user.findMany.mockResolvedValue(users);

      await expect(influencersService.findEligibleManagers()).resolves.toEqual(
        users,
      );
      expect(prismaService.user.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
      });
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
