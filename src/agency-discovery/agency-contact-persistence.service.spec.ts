jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import {
  AgencyContactKind,
  AgencyRelevanceStatus,
  CommercialRelevance,
} from '../generated/prisma/enums';
import { CONTACT_EMAIL_VERIFICATION_STATUS } from '../lead-discovery/utils/contact-email-attribution.util';
import { AgencyContactPersistenceService } from './agency-contact-persistence.service';

describe('AgencyContactPersistenceService (2C.4.3 / 2C.4.3.1)', () => {
  const agencyId = 'agency-1';
  const influencerId = 'influencer-1';
  const agencyDomain = 'creatorpartners.example';

  const agencyContactFindUnique = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const influencerAgencyFindUnique = jest.fn();

  const prisma = {
    agencyContact: {
      findUnique: agencyContactFindUnique,
      create,
      update,
    },
    influencerAgency: {
      findUnique: influencerAgencyFindUnique,
    },
    brandBusinessContact: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  let service: AgencyContactPersistenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AgencyContactPersistenceService(prisma as never);
    create.mockResolvedValue({ id: 'ac-1' });
    update.mockResolvedValue({ id: 'ac-1' });
    influencerAgencyFindUnique.mockResolvedValue({
      relevanceStatus: AgencyRelevanceStatus.UNDER_REVIEW,
    });
  });

  function baseInput(
    overrides: Partial<
      Parameters<AgencyContactPersistenceService['upsertFromDiscovery']>[0]
    > = {},
  ) {
    return {
      influencerId,
      agencyId,
      agencyDomain,
      email: 'Partnerships@CreatorPartners.Example',
      sourceUrl: 'https://creatorpartners.example/contact',
      evidenceSnippet: 'Email us at partnerships@creatorpartners.example',
      ...overrides,
    };
  }

  function expectEligibilityLookup() {
    expect(influencerAgencyFindUnique).toHaveBeenCalledWith({
      where: {
        influencerId_agencyId: { influencerId, agencyId },
      },
      select: { relevanceStatus: true },
    });
  }

  it('normalizes email and creates AgencyContact when Prisma association is UNDER_REVIEW', async () => {
    agencyContactFindUnique.mockResolvedValue(null);

    const result = await service.upsertFromDiscovery(baseInput());

    expectEligibilityLookup();
    expect(result).toEqual({
      id: 'ac-1',
      created: true,
      updated: false,
      skipped: false,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agencyId,
          emailNormalized: 'partnerships@creatorpartners.example',
          contactKind: AgencyContactKind.MAILBOX,
          commercialRelevance: CommercialRelevance.HIGH,
        }),
      }),
    );
    expect(prisma.brandBusinessContact.create).not.toHaveBeenCalled();
  });

  it('allows persist when persisted association is RELEVANT', async () => {
    influencerAgencyFindUnique.mockResolvedValue({
      relevanceStatus: AgencyRelevanceStatus.RELEVANT,
    });
    agencyContactFindUnique.mockResolvedValue(null);

    const result = await service.upsertFromDiscovery(baseInput());

    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalled();
  });

  it('blocks NOT_RELEVANT and DISCARDED from Prisma (no create/update)', async () => {
    agencyContactFindUnique.mockResolvedValue(null);

    influencerAgencyFindUnique.mockResolvedValue({
      relevanceStatus: AgencyRelevanceStatus.NOT_RELEVANT,
    });
    expect(
      (await service.upsertFromDiscovery(baseInput())).skipReason,
    ).toBe('relevance_not_relevant');

    influencerAgencyFindUnique.mockResolvedValue({
      relevanceStatus: AgencyRelevanceStatus.DISCARDED,
    });
    expect(
      (await service.upsertFromDiscovery(baseInput())).skipReason,
    ).toBe('relevance_discarded');

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(agencyContactFindUnique).not.toHaveBeenCalled();
  });

  it('blocks when InfluencerAgency association is missing', async () => {
    influencerAgencyFindUnique.mockResolvedValue(null);

    const result = await service.upsertFromDiscovery(baseInput());

    expect(result).toEqual({
      id: null,
      created: false,
      updated: false,
      skipped: true,
      skipReason: 'association_missing',
    });
    expect(create).not.toHaveBeenCalled();
    expect(agencyContactFindUnique).not.toHaveBeenCalled();
  });

  it('2C.4.3.1: without input.relevanceStatus still loads Prisma and validates', async () => {
    agencyContactFindUnique.mockResolvedValue(null);

    const result = await service.upsertFromDiscovery(
      baseInput({ relevanceStatus: undefined }),
    );

    expectEligibilityLookup();
    expect(result.created).toBe(true);
  });

  it('2C.4.3.1: ignores manipulated input RELEVANT when Prisma is DISCARDED', async () => {
    influencerAgencyFindUnique.mockResolvedValue({
      relevanceStatus: AgencyRelevanceStatus.DISCARDED,
    });

    const result = await service.upsertFromDiscovery(
      baseInput({ relevanceStatus: AgencyRelevanceStatus.RELEVANT }),
    );

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('relevance_discarded');
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('2C.4.3.1: ignores manipulated input DISCARDED when Prisma is RELEVANT', async () => {
    influencerAgencyFindUnique.mockResolvedValue({
      relevanceStatus: AgencyRelevanceStatus.RELEVANT,
    });
    agencyContactFindUnique.mockResolvedValue(null);

    const result = await service.upsertFromDiscovery(
      baseInput({ relevanceStatus: AgencyRelevanceStatus.DISCARDED }),
    );

    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalled();
  });

  it('dedupes by agencyId+emailNormalized (idempotent upsert)', async () => {
    agencyContactFindUnique.mockResolvedValue({
      id: 'ac-1',
      agencyId,
      emailNormalized: 'partnerships@creatorpartners.example',
      contactKind: AgencyContactKind.MAILBOX,
      isGeneric: true,
      commercialRelevance: CommercialRelevance.HIGH,
      label: 'Partnerships',
      displayName: null,
      title: null,
      metadata: {
        evidences: [
          {
            sourceUrl: 'https://creatorpartners.example/contact',
            evidenceSnippet: 'short',
            discoveredAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        discoveryStatus: 'FOUND',
        attributionStatus: 'ATTRIBUTED',
        verificationStatus: 'UNVERIFIED',
      },
    });

    const result = await service.upsertFromDiscovery(
      baseInput({
        evidenceSnippet:
          'Reach partnerships@creatorpartners.example for creator deals',
      }),
    );

    expect(result.updated).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data.metadata.verificationStatus).toBe(
      CONTACT_EMAIL_VERIFICATION_STATUS.UNVERIFIED,
    );
  });

  it('never writes BrandBusinessContact tables', async () => {
    agencyContactFindUnique.mockResolvedValue(null);
    await service.upsertFromDiscovery(baseInput());
    expect(prisma.brandBusinessContact.create).not.toHaveBeenCalled();
    expect(prisma.brandBusinessContact.update).not.toHaveBeenCalled();
  });
});
