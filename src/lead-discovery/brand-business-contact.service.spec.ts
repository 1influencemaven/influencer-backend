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

    it('maps persisted fields, evidences, and RF-01 provenance (case 12 historical)', async () => {
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
          commercialCoverageTier: 'HIGH',
          discoveryStatus: 'FOUND',
          attributionStatus: 'ATTRIBUTED',
          verificationStatus: 'UNVERIFIED',
        }),
      );
      expect(result[1].evidences).toEqual([
        {
          sourceUrl: 'https://brand.com/contact',
          evidenceSnippet: 'info@brand.com',
          discoveredAt: '2026-09-13T12:00:00.000Z',
        },
      ]);
      expect(result[1].commercialCoverageTier).toBe('GENERAL');
      // Case 10: historical rows are never presented as SMTP-verified.
      expect(result[1].verificationStatus).toBe('UNVERIFIED');
    });

    it('RF-02.1: historical person-like UNKNOWN maps to OTHER, not GENERAL', async () => {
      prisma.brandCandidate.findUnique.mockResolvedValue({ id: 'b1' });
      prisma.brandBusinessContact.findMany.mockResolvedValue([
        {
          id: 'bbc-person',
          brandCandidateId: 'b1',
          email: 'john.smith@brand.com',
          label: null,
          isGeneric: false,
          commercialRelevance: CommercialRelevance.UNKNOWN,
          source: ContactChannelSource.PUBLIC_WEB,
          sourceUrl: 'https://brand.com/team',
          metadata: { evidences: [] },
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.listByBrandCandidateId('b1');
      expect(result[0].commercialRelevance).toBe(CommercialRelevance.UNKNOWN);
      expect(result[0].commercialCoverageTier).toBe('OTHER');
    });
  });

  it('creates BBC for official domain email with FOUND/ATTRIBUTED/UNVERIFIED (cases 1,4,5,10)', async () => {
    prisma.brandBusinessContact.findUnique.mockResolvedValue(null);
    prisma.brandBusinessContact.create.mockResolvedValue({ id: 'bbc1' });

    const result = await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'Partnerships@Brand.com',
      sourceUrl: 'https://brand.com/partnerships',
      evidenceSnippet: 'Email partnerships@brand.com',
      brandDomain: 'brand.com',
    });

    expect(result).toEqual({
      id: 'bbc1',
      created: true,
      updated: false,
      skipped: false,
    });
    expect(prisma.brandBusinessContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailNormalized: 'partnerships@brand.com',
          commercialRelevance: CommercialRelevance.HIGH,
          isGeneric: true,
          source: ContactChannelSource.PUBLIC_WEB,
          metadata: expect.objectContaining({
            discoveryStatus: 'FOUND',
            attributionStatus: 'ATTRIBUTED',
            verificationStatus: 'UNVERIFIED',
          }),
        }),
      }),
    );
  });

  it('accepts info@ as corporate GENERAL (UNKNOWN) generic (RF-02 case 6)', async () => {
    prisma.brandBusinessContact.findUnique.mockResolvedValue(null);
    prisma.brandBusinessContact.create.mockResolvedValue({ id: 'bbc-info' });

    const result = await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'info@brand.com',
      sourceUrl: 'https://brand.com/contact',
      evidenceSnippet: 'info@brand.com',
      brandDomain: 'brand.com',
    });

    expect(result.skipped).toBe(false);
    expect(prisma.brandBusinessContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commercialRelevance: CommercialRelevance.UNKNOWN,
          isGeneric: true,
        }),
      }),
    );
  });

  it('classifies support@ as LOW (case 6)', async () => {
    prisma.brandBusinessContact.findUnique.mockResolvedValue(null);
    prisma.brandBusinessContact.create.mockResolvedValue({ id: 'bbc-support' });

    await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'support@brand.com',
      sourceUrl: 'https://brand.com/contact',
      evidenceSnippet: 'support@brand.com',
      brandDomain: 'brand.com',
    });

    expect(prisma.brandBusinessContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commercialRelevance: CommercialRelevance.LOW,
        }),
      }),
    );
  });

  it('skips noreply@ (case 7)', async () => {
    const result = await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'noreply@brand.com',
      sourceUrl: 'https://brand.com/contact',
      evidenceSnippet: 'noreply@brand.com',
      brandDomain: 'brand.com',
    });

    expect(result).toEqual({
      id: null,
      created: false,
      updated: false,
      skipped: true,
      skipReason: 'domain_blocked_local',
    });
    expect(prisma.brandBusinessContact.create).not.toHaveBeenCalled();
  });

  it('skips uncorroborated third-party domain (case 3)', async () => {
    const result = await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'hello@agency.com',
      sourceUrl: 'https://brand.com/partners',
      evidenceSnippet: 'hello@agency.com',
      brandDomain: 'brand.com',
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('domain_external_domain');
    expect(prisma.brandBusinessContact.create).not.toHaveBeenCalled();
  });

  it('accepts corroborated alternate domain (case 2)', async () => {
    prisma.brandBusinessContact.findUnique.mockResolvedValue(null);
    prisma.brandBusinessContact.create.mockResolvedValue({ id: 'bbc-eu' });

    const result = await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'collab@brand-eu.com',
      sourceUrl: 'https://brand.com/contact',
      evidenceSnippet: 'collab@brand-eu.com',
      brandDomain: 'brand.com',
      corroboratedDomains: ['brand-eu.com'],
    });

    expect(result.skipped).toBe(false);
    expect(result.created).toBe(true);
  });

  it('merges evidence and never downgrades HIGH (case 11)', async () => {
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
        discoveryStatus: 'FOUND',
        attributionStatus: 'ATTRIBUTED',
        verificationStatus: 'UNVERIFIED',
      },
    });
    prisma.brandBusinessContact.update.mockResolvedValue({ id: 'bbc1' });

    const result = await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'partnerships@brand.com',
      sourceUrl: 'https://brand.com/contact',
      evidenceSnippet: 'Also partnerships@brand.com',
      brandDomain: 'brand.com',
      commercialRelevance: CommercialRelevance.UNKNOWN,
    });

    expect(result.updated).toBe(true);
    const updateData = prisma.brandBusinessContact.update.mock.calls[0][0].data;
    expect(updateData.commercialRelevance).toBe(CommercialRelevance.HIGH);
    expect(updateData.metadata.evidences).toHaveLength(2);
    expect(updateData.metadata.verificationStatus).toBe('UNVERIFIED');
  });

  it('prefers longer evidence snippet for the same sourceUrl (case 11 quality)', async () => {
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
            evidenceSnippet: 'short',
            discoveredAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    });
    prisma.brandBusinessContact.update.mockResolvedValue({ id: 'bbc1' });

    await service.upsertFromDiscovery({
      brandCandidateId: 'b1',
      email: 'partnerships@brand.com',
      sourceUrl: 'https://brand.com/partnerships',
      evidenceSnippet: 'longer evidence snippet partnerships@brand.com',
      brandDomain: 'brand.com',
    });

    const updateData = prisma.brandBusinessContact.update.mock.calls[0][0].data;
    expect(updateData.metadata.evidences).toHaveLength(1);
    expect(updateData.metadata.evidences[0].evidenceSnippet).toBe(
      'longer evidence snippet partnerships@brand.com',
    );
  });
});
