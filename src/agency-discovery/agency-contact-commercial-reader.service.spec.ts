jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { NotFoundException } from '@nestjs/common';
import {
  AgencyContactKind,
  AgencyRelevanceStatus,
  CommercialRelevance,
} from '../generated/prisma/enums';
import { AgencyContactCommercialReaderService } from './agency-contact-commercial-reader.service';

describe('AgencyContactCommercialReaderService (2C.4.7)', () => {
  const influencerFindUnique = jest.fn();
  const influencerAgencyFindMany = jest.fn();
  const agencyContactCreate = jest.fn();
  const agencyContactUpdate = jest.fn();

  const prisma = {
    influencer: { findUnique: influencerFindUnique },
    influencerAgency: { findMany: influencerAgencyFindMany },
    agencyContact: {
      create: agencyContactCreate,
      update: agencyContactUpdate,
    },
  };

  let service: AgencyContactCommercialReaderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AgencyContactCommercialReaderService(prisma as never);
    influencerFindUnique.mockResolvedValue({ id: 'inf-1' });
  });

  function association(params: {
    relevanceStatus: AgencyRelevanceStatus;
    agencyId?: string;
    contacts: Array<{
      id: string;
      contactKind: AgencyContactKind;
      email: string;
      commercialRelevance: CommercialRelevance;
      displayName?: string | null;
      title?: string | null;
      metadata?: unknown;
    }>;
  }) {
    return {
      relevanceStatus: params.relevanceStatus,
      agency: {
        id: params.agencyId ?? 'agency-1',
        name: 'Creator Partners',
        domain: 'creatorpartners.example',
        contacts: params.contacts.map((c) => ({
          id: c.id,
          contactKind: c.contactKind,
          email: c.email,
          emailNormalized: c.email.toLowerCase(),
          displayName: c.displayName ?? null,
          title: c.title ?? null,
          label: null,
          isGeneric: c.contactKind === AgencyContactKind.MAILBOX,
          commercialRelevance: c.commercialRelevance,
          metadata: c.metadata ?? {
            evidences: [
              {
                sourceUrl: 'https://creatorpartners.example/contact',
                evidenceSnippet: c.email,
                discoveredAt: new Date().toISOString(),
              },
            ],
            discoveryStatus: 'FOUND',
            attributionStatus: 'ATTRIBUTED',
            verificationStatus: 'UNVERIFIED',
            sourceKind:
              c.contactKind === AgencyContactKind.PERSON
                ? 'linkedin'
                : 'agency_web',
            outreachRole: 'Partnerships',
          },
          discoveredAt: new Date('2026-01-15T00:00:00.000Z'),
        })),
      },
    };
  }

  it('404 when influencer missing', async () => {
    influencerFindUnique.mockResolvedValue(null);
    await expect(
      service.listForInfluencer({ influencerId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(influencerAgencyFindMany).not.toHaveBeenCalled();
  });

  it('queries only associations for the given influencer', async () => {
    influencerAgencyFindMany.mockResolvedValue([]);
    await service.listForInfluencer({ influencerId: 'inf-1' });
    expect(influencerAgencyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          influencerId: 'inf-1',
          relevanceStatus: {
            in: [
              AgencyRelevanceStatus.RELEVANT,
              AgencyRelevanceStatus.UNDER_REVIEW,
            ],
          },
        }),
      }),
    );
  });

  it('RELEVANT HIGH → ACTIONABLE; keeps agencyContactId and 2C origin', async () => {
    influencerAgencyFindMany.mockResolvedValue([
      association({
        relevanceStatus: AgencyRelevanceStatus.RELEVANT,
        contacts: [
          {
            id: 'ac-1',
            contactKind: AgencyContactKind.MAILBOX,
            email: 'partnerships@creatorpartners.example',
            commercialRelevance: CommercialRelevance.HIGH,
          },
        ],
      }),
    ]);

    const rows = await service.listForInfluencer({ influencerId: 'inf-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agencyId: 'agency-1',
      agencyContactId: 'ac-1',
      eligibilityStatus: 'ACTIONABLE',
      priority: true,
      origin: 'AGENCY_CONTACT_RESEARCH',
      track: '2C',
      researchOperation: 'FIND_AGENCY_EMAILS',
      contactKind: AgencyContactKind.MAILBOX,
      provenance: {
        discoveryStatus: 'FOUND',
        attributionStatus: 'ATTRIBUTED',
        verificationStatus: 'UNVERIFIED',
      },
    });
    expect(rows[0]?.provenance.verificationStatus).toBe('UNVERIFIED');
  });

  it('UNDER_REVIEW → VISIBLE_NOT_ACTIONABLE', async () => {
    influencerAgencyFindMany.mockResolvedValue([
      association({
        relevanceStatus: AgencyRelevanceStatus.UNDER_REVIEW,
        contacts: [
          {
            id: 'ac-2',
            contactKind: AgencyContactKind.PERSON,
            email: 'alex@creatorpartners.example',
            commercialRelevance: CommercialRelevance.HIGH,
            displayName: 'Alex Partner',
            title: 'Influencer Marketing',
          },
        ],
      }),
    ]);

    const rows = await service.listForInfluencer({ influencerId: 'inf-1' });
    expect(rows[0]?.eligibilityStatus).toBe('VISIBLE_NOT_ACTIONABLE');
    expect(rows[0]?.priority).toBe(false);
    expect(rows[0]?.researchOperation).toBe('FIND_AGENCY_PEOPLE');
    expect(rows[0]?.contactKind).toBe(AgencyContactKind.PERSON);
  });

  it('does not invent VERIFIED; preserves UNVERIFIED', async () => {
    influencerAgencyFindMany.mockResolvedValue([
      association({
        relevanceStatus: AgencyRelevanceStatus.RELEVANT,
        contacts: [
          {
            id: 'ac-3',
            contactKind: AgencyContactKind.MAILBOX,
            email: 'hello@creatorpartners.example',
            commercialRelevance: CommercialRelevance.NEUTRAL,
            metadata: {
              evidences: [],
              discoveryStatus: 'FOUND',
              attributionStatus: 'ATTRIBUTED',
              // missing verificationStatus
              sourceKind: 'agency_web',
            },
          },
        ],
      }),
    ]);

    const rows = await service.listForInfluencer({ influencerId: 'inf-1' });
    expect(rows[0]?.provenance.verificationStatus).toBe('UNVERIFIED');
    expect(rows[0]?.provenance.verificationStatus).not.toBe('VERIFIED');
  });

  it('UNKNOWN is visible not priority; LOW excluded by query filter set', async () => {
    influencerAgencyFindMany.mockResolvedValue([
      association({
        relevanceStatus: AgencyRelevanceStatus.RELEVANT,
        contacts: [
          {
            id: 'ac-unk',
            contactKind: AgencyContactKind.MAILBOX,
            email: 'info@creatorpartners.example',
            commercialRelevance: CommercialRelevance.UNKNOWN,
          },
        ],
      }),
    ]);

    const rows = await service.listForInfluencer({ influencerId: 'inf-1' });
    expect(rows[0]?.eligibilityStatus).toBe('VISIBLE_NOT_PRIORITY');

    // Simulate Prisma not returning LOW (reader where excludes LOW).
    expect(
      influencerAgencyFindMany.mock.calls[0][0].select.agency.select.contacts
        .where.commercialRelevance,
    ).toEqual({
      in: [
        CommercialRelevance.HIGH,
        CommercialRelevance.NEUTRAL,
        CommercialRelevance.UNKNOWN,
      ],
    });
  });

  it('read-only: never creates/updates AgencyContact; no Mastra deps', async () => {
    influencerAgencyFindMany.mockResolvedValue([]);
    await service.listForInfluencer({ influencerId: 'inf-1' });
    expect(agencyContactCreate).not.toHaveBeenCalled();
    expect(agencyContactUpdate).not.toHaveBeenCalled();
  });

  it('excludes other influencers by association query (no arbitrary agencyId)', async () => {
    influencerAgencyFindMany.mockResolvedValue([
      association({
        relevanceStatus: AgencyRelevanceStatus.RELEVANT,
        agencyId: 'agency-shared',
        contacts: [
          {
            id: 'ac-x',
            contactKind: AgencyContactKind.MAILBOX,
            email: 'p@creatorpartners.example',
            commercialRelevance: CommercialRelevance.HIGH,
          },
        ],
      }),
    ]);

    await service.listForInfluencer({ influencerId: 'inf-1' });
    expect(influencerAgencyFindMany.mock.calls[0][0].where.influencerId).toBe(
      'inf-1',
    );
  });
});
