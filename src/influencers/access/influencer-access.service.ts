import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUser } from '../../auth/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';

export type AccessibleInfluencer = {
  id: string;
  name: string;
  managerId: string | null;
};

/**
 * Single place that decides whether a user can work with a talent's templates
 * and prospects (HU-TPL-001 CA-03, HU-TPL-003 CA-05).
 *
 * Current product rule (2026-11-26): every authenticated USER/ADMIN sees every
 * talent. Pending client confirmation; restricting USER to
 * `managerId === user.id` would only change `canAccess` below.
 */
@Injectable()
export class InfluencerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  canAccess(
    user: Pick<AuthUser, 'id' | 'role'>,
    influencer: AccessibleInfluencer,
  ): boolean {
    void user;
    void influencer;
    return true;
  }

  /** Returns the talent or throws 404 (also used when access is denied, to avoid leaking ids). */
  async assertCanAccess(
    user: Pick<AuthUser, 'id' | 'role'>,
    influencerId: string,
  ): Promise<AccessibleInfluencer> {
    const influencer = await this.prisma.influencer.findUnique({
      where: { id: influencerId },
      select: { id: true, name: true, managerId: true },
    });
    if (!influencer || !this.canAccess(user, influencer)) {
      throw new NotFoundException({
        message: 'Talent not found.',
        code: 'INFLUENCER_NOT_FOUND',
      });
    }
    return influencer;
  }
}
