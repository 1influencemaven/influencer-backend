jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));
jest.mock('../email-accounts/email-accounts.service', () => ({
  EmailAccountsService: class EmailAccountsService {},
}));

import {
  BrandCandidateStatus,
  BrandDiscoveryStatus,
  IbpStatus,
  LeadDiscoveryStatus,
} from '../generated/prisma/enums';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const prisma = {
    influencer: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    brandCandidate: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    lead: {
      count: jest.fn(),
    },
    brandBusinessContact: {
      count: jest.fn(),
    },
    brandDiscoveryRun: {
      findMany: jest.fn(),
    },
    leadDiscoveryRun: {
      findMany: jest.fn(),
    },
  };

  const emailAccounts = {
    list: jest.fn(),
  };

  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DashboardService(prisma as never, emailAccounts as never);

    prisma.influencer.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(7);
    prisma.brandCandidate.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2);
    prisma.lead.count.mockResolvedValue(5);
    prisma.brandBusinessContact.count.mockResolvedValue(3);
    emailAccounts.list.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 1, total: 0, totalPages: 0 },
      counts: { connected: 8, disconnected: 1, paused: 0 },
    });
    prisma.influencer.findMany
      .mockResolvedValueOnce([{ id: 'inf-failed', name: 'Failed Talent' }])
      .mockResolvedValueOnce([{ id: 'inf-draft', name: 'Draft Talent' }]);
    prisma.brandCandidate.findMany.mockResolvedValue([
      {
        id: 'bc-1',
        name: 'Acme',
        influencerId: 'inf-1',
        influencer: { name: 'Laura' },
      },
    ]);
    prisma.brandDiscoveryRun.findMany.mockResolvedValue([
      {
        id: 'bdr-1',
        influencerId: 'inf-1',
        influencer: { name: 'Laura' },
        updatedAt: new Date('2026-11-20T10:00:00.000Z'),
      },
    ]);
    prisma.leadDiscoveryRun.findMany.mockResolvedValue([
      {
        id: 'ldr-1',
        influencerId: 'inf-2',
        influencer: { name: 'Ana' },
        brandCandidate: { name: 'Brand X' },
        updatedAt: new Date('2026-11-21T10:00:00.000Z'),
      },
    ]);
  });

  it('aggregates metrics and builds a capped attention queue', async () => {
    const result = await service.getStats();

    expect(result.metrics).toEqual({
      talentsActiveIbp: 7,
      talentsNeedingIbp: 3,
      brandsUnderReview: 4,
      approvedWithoutContacts: 2,
      readyContacts: 8,
      emailAccountsConnected: 8,
      emailAccountsDisconnected: 1,
    });

    expect(prisma.influencer.count).toHaveBeenCalledWith();
    expect(prisma.influencer.count).toHaveBeenCalledWith({
      where: { idealBrandProfile: { status: IbpStatus.ACTIVE } },
    });
    expect(prisma.brandCandidate.count).toHaveBeenCalledWith({
      where: { status: BrandCandidateStatus.UNDER_REVIEW },
    });
    expect(prisma.brandDiscoveryRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: BrandDiscoveryStatus.FAILED },
      }),
    );
    expect(prisma.leadDiscoveryRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: LeadDiscoveryStatus.FAILED },
      }),
    );

    expect(result.attention[0]).toMatchObject({
      type: 'IBP_FAILED',
      entityId: 'inf-failed',
      href: '/dashboard/creators/inf-failed',
    });
    expect(result.attention.some((item) => item.type === 'IBP_DRAFT')).toBe(
      true,
    );
    expect(
      result.attention.some((item) => item.type === 'BRANDS_UNDER_REVIEW'),
    ).toBe(true);
    expect(
      result.attention.some((item) => item.type === 'APPROVED_NO_CONTACTS'),
    ).toBe(true);
    expect(
      result.attention.some((item) => item.type === 'DISCOVERY_FAILED'),
    ).toBe(true);
    expect(
      result.attention.some((item) => item.type === 'EMAIL_DISCONNECTED'),
    ).toBe(true);
    expect(result.attention.length).toBeLessThanOrEqual(10);
  });

  it('returns null email metrics when Saleshandy is unavailable', async () => {
    emailAccounts.list.mockRejectedValue(new Error('not configured'));

    const result = await service.getStats();

    expect(result.metrics.emailAccountsConnected).toBeNull();
    expect(result.metrics.emailAccountsDisconnected).toBeNull();
    expect(
      result.attention.some((item) => item.type === 'EMAIL_DISCONNECTED'),
    ).toBe(false);
  });
});
