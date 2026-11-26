jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { NotFoundException } from '@nestjs/common';

import { InfluencerAccessService } from './influencer-access.service';

describe('InfluencerAccessService', () => {
  const user = { id: 'u1', role: 'USER' as const };

  it('lets any authenticated user access an existing talent (current rule)', async () => {
    const prisma = {
      influencer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'i1',
          name: 'Ana',
          managerId: 'other',
        }),
      },
    };
    const service = new InfluencerAccessService(prisma as never);
    await expect(service.assertCanAccess(user, 'i1')).resolves.toEqual({
      id: 'i1',
      name: 'Ana',
      managerId: 'other',
    });
  });

  it('throws 404 for a missing talent', async () => {
    const prisma = {
      influencer: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new InfluencerAccessService(prisma as never);
    await expect(service.assertCanAccess(user, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
