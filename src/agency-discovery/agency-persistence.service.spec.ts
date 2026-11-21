jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import type { AgencyDiscoveryCandidate } from '@influence-maven/ai-contracts';
import { AgencyRelevanceStatus, AgencyType } from '../generated/prisma/enums';

import { AgencyPersistenceService } from './agency-persistence.service';

describe('AgencyPersistenceService (2C.2)', () => {
  const influencerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const influencerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function candidate(
    overrides?: Partial<AgencyDiscoveryCandidate>,
  ): AgencyDiscoveryCandidate {
    return {
      agency: {
        name: 'Glow Collab',
        domain: 'glow.example',
        website: 'https://glow.example',
        agencyType: 'INFLUENCER_MARKETING_AGENCY',
      },
      association: {
        relevanceStatus: 'RELEVANT',
        relevanceExplanation: 'Connects brands with creators',
        niches: ['beauty'],
        markets: ['US'],
        evidenceUrls: ['https://glow.example/brands'],
        evidence: [
          {
            url: 'https://glow.example/brands',
            excerpt: 'Connects brands with creators',
          },
        ],
      },
      ...overrides,
    };
  }

  it('creates agency once and associates two influencers', async () => {
    const agencyFindUnique = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'agency-1',
        agencyType: AgencyType.INFLUENCER_MARKETING_AGENCY,
        name: 'Glow Collab',
        website: 'https://glow.example',
        country: null,
        description: null,
      });
    const agencyCreate = jest.fn().mockResolvedValue({ id: 'agency-1' });
    const agencyUpdate = jest.fn();
    const assocFindUnique = jest.fn().mockResolvedValue(null);
    const assocCreate = jest
      .fn()
      .mockResolvedValueOnce({ id: 'ia-1' })
      .mockResolvedValueOnce({ id: 'ia-2' });

    const prisma = {
      agency: {
        findUnique: agencyFindUnique,
        create: agencyCreate,
        update: agencyUpdate,
      },
      influencerAgency: {
        findUnique: assocFindUnique,
        create: assocCreate,
        update: jest.fn(),
      },
    };

    const service = new AgencyPersistenceService(prisma as never);
    const first = await service.upsertCandidate({
      influencerId: influencerA,
      candidate: candidate(),
    });
    const second = await service.upsertCandidate({
      influencerId: influencerB,
      candidate: candidate(),
    });

    expect(agencyCreate).toHaveBeenCalledTimes(1);
    expect(assocCreate).toHaveBeenCalledTimes(2);
    expect(first.agencyId).toBe('agency-1');
    expect(second.agencyId).toBe('agency-1');
    expect(first.associationCreated).toBe(true);
    expect(second.associationCreated).toBe(true);
  });

  it('merges evidence without degrading RELEVANT status', async () => {
    const agencyFindUnique = jest.fn().mockResolvedValue({
      id: 'agency-1',
      agencyType: AgencyType.INFLUENCER_MARKETING_AGENCY,
      name: 'Glow Collab',
      website: 'https://glow.example',
      country: null,
      description: 'old',
    });
    const assocFindUnique = jest.fn().mockResolvedValue({
      id: 'ia-1',
      relevanceStatus: AgencyRelevanceStatus.RELEVANT,
      relevanceExplanation: 'Strong evidence',
      niches: ['beauty'],
      markets: ['US'],
      evidenceUrls: ['https://glow.example/brands'],
    });
    const assocUpdate = jest.fn().mockResolvedValue({ id: 'ia-1' });

    const prisma = {
      agency: {
        findUnique: agencyFindUnique,
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      influencerAgency: {
        findUnique: assocFindUnique,
        create: jest.fn(),
        update: assocUpdate,
      },
    };

    const service = new AgencyPersistenceService(prisma as never);
    await service.upsertCandidate({
      influencerId: influencerA,
      candidate: candidate({
        association: {
          relevanceStatus: 'UNDER_REVIEW',
          relevanceExplanation: 'Weaker pass',
          niches: ['skincare'],
          markets: ['US'],
          evidenceUrls: ['https://glow.example/about'],
        },
      }),
    });

    expect(assocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          relevanceStatus: AgencyRelevanceStatus.RELEVANT,
          evidenceUrls: expect.arrayContaining([
            'https://glow.example/brands',
            'https://glow.example/about',
          ]),
          niches: expect.arrayContaining(['beauty', 'skincare']),
        }),
      }),
    );
  });
});
