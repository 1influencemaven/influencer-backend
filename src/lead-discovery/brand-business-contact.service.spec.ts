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
    brandBusinessContact: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: BrandBusinessContactService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BrandBusinessContactService(prisma as never);
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
