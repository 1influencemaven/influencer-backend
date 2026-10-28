jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import {
  CommercialRelevance,
  ContactChannelSource,
} from '../generated/prisma/enums';

import { BrandBusinessContactService } from './brand-business-contact.service';

describe('BrandBusinessContactService', () => {
  const prisma = {
    brandCandidate: {
      findUnique: jest.fn(),
    },
    brandBusinessContact: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: BrandBusinessContactService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BrandBusinessContactService(prisma as never);
  });

  describe('listByBrandCandidateId', () => {
    it('throws NotFoundException when brand candidate is missing', async () => {
      prisma.brandCandidate.findUnique.mockResolvedValue(null);

      await expect(service.listByBrandCandidateId('missing')).rejects.toThrow(
        'Brand candidate missing not found',
      );
      expect(prisma.brandBusinessContact.findMany).not.toHaveBeenCalled();
    });

    it('returns empty array when brand exists but has no contacts', async () => {
      prisma.brandCandidate.findUnique.mockResolvedValue({ id: 'b1' });
      prisma.brandBusinessContact.findMany.mockResolvedValue([]);

      await expect(service.listByBrandCandidateId('b1')).resolves.toEqual([]);
    });

    it('maps persisted fields and evidences without inventing emails', async () => {
      const createdAt = new Date('2026-09-13T12:00:00.000Z');
      const updatedAt = new Date('2026-09-13T13:00:00.000Z');
      prisma.brandCandidate.findUnique.mockResolvedValue({ id: 'b1' });
      prisma.brandBusinessContact.findMany.mockResolvedValue([
        {
          id: 'bbc-low',
          brandCandidateId: 'b1',
          email: 'info@brand.com',
          label: 'Info',
          isGeneric: true,
          commercialRelevance: CommercialRelevance.UNKNOWN,
          source: ContactChannelSource.PUBLIC_WEB,
          sourceUrl: 'https://brand.com/contact',
          metadata: {
            evidences: [
              {
                sourceUrl: 'https://brand.com/contact',
                evidenceSnippet: 'info@brand.com',
                discoveredAt: '2026-09-13T12:00:00.000Z',
              },
            ],
          },
          createdAt,
          updatedAt,
        },
        {
          id: 'bbc-high',
          brandCandidateId: 'b1',
          email: 'partnerships@brand.com',
          label: 'Partnerships',
          isGeneric: true,
          commercialRelevance: CommercialRelevance.HIGH,
          source: ContactChannelSource.PUBLIC_WEB,
          sourceUrl: 'https://brand.com/partnerships',
          metadata: { evidences: [] },
          createdAt: new Date('2026-09-13T11:00:00.000Z'),
          updatedAt,
        },
      ]);

      const result = await service.listByBrandCandidateId('b1');

      expect(result.map((row) => row.id)).toEqual(['bbc-high', 'bbc-low']);
      expect(result[0]).toEqual(
        expect.objectContaining({
          email: 'partnerships@brand.com',
          commercialRelevance: CommercialRelevance.HIGH,
          sourceUrl: 'https://brand.com/partnerships',
          evidences: [],
        }),
      );
      expect(result[1].evidences).toEqual([
        {
          sourceUrl: 'https://brand.com/contact',
          evidenceSnippet: 'info@brand.com',
          discoveredAt: '2026-09-13T12:00:00.000Z',
        },
      ]);
    });
  });

  it('creates a new BrandBusinessContact with evidence', async () => {
    prisma.brandBusinessContact.findUnique.mockResolvedValue(null);
    prisma.brandBusinessContact.create.mockResolvedValue({ id: 'bbc1' });

    const result = await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'Partnerships@Brand.com',
      sourceUrl: 'https://brand.com/partnerships',
      evidenceSnippet: 'Email partnerships@brand.com',
    });

    expect(result).toEqual({ id: 'bbc1', created: true, updated: false });
    expect(prisma.brandBusinessContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailNormalized: 'partnerships@brand.com',
          commercialRelevance: CommercialRelevance.HIGH,
          isGeneric: true,
          source: ContactChannelSource.PUBLIC_WEB,
        }),
      }),
    );
  });

  it('merges evidence and never downgrades HIGH', async () => {
    prisma.brandBusinessContact.findUnique.mockResolvedValue({
      id: 'bbc1',
      commercialRelevance: CommercialRelevance.HIGH,
      isGeneric: true,
      label: 'Partnerships',
      sourceUrl: 'https://brand.com/partnerships',
      metadata: {
        evidences: [
          {
            sourceUrl: 'https://brand.com/partnerships',
            evidenceSnippet: 'partnerships@brand.com',
            discoveredAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    });
    prisma.brandBusinessContact.update.mockResolvedValue({ id: 'bbc1' });

    const result = await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'partnerships@brand.com',
      sourceUrl: 'https://brand.com/contact',
      evidenceSnippet: 'Also partnerships@brand.com',
      commercialRelevance: CommercialRelevance.UNKNOWN,
    });

    expect(result.updated).toBe(true);
    const updateData = prisma.brandBusinessContact.update.mock.calls[0][0].data;
    expect(updateData.commercialRelevance).toBe(CommercialRelevance.HIGH);
    expect(updateData.metadata.evidences).toHaveLength(2);
  });
});
