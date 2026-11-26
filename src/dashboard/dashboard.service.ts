import { Injectable, Logger } from '@nestjs/common';

import { EmailAccountsService } from '../email-accounts/email-accounts.service';
import {
  BrandCandidateStatus,
  BrandDiscoveryStatus,
  CommercialRelevance,
  IbpStatus,
  LeadDiscoveryStatus,
  LeadEmailConfidence,
  LeadStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DashboardAttentionItem,
  DashboardStatsResponse,
} from './dashboard.types';

const ATTENTION_LIMIT = 10;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailAccounts: EmailAccountsService,
  ) {}

  async getStats(): Promise<DashboardStatsResponse> {
    const [
      totalTalents,
      talentsActiveIbp,
      brandsUnderReview,
      approvedWithoutContacts,
      readyLeads,
      readyBusinessContacts,
      emailCounts,
      failedIbps,
      needingIbpTalents,
      approvedNoContactSamples,
      failedBrandRuns,
      failedLeadRuns,
    ] = await Promise.all([
      this.prisma.influencer.count(),
      this.prisma.influencer.count({
        where: { idealBrandProfile: { status: IbpStatus.ACTIVE } },
      }),
      this.prisma.brandCandidate.count({
        where: { status: BrandCandidateStatus.UNDER_REVIEW },
      }),
      this.prisma.brandCandidate.count({
        where: {
          status: BrandCandidateStatus.APPROVED,
          leads: { none: {} },
          brandBusinessContacts: { none: {} },
        },
      }),
      this.prisma.lead.count({
        where: {
          email: { not: null },
          isGeneric: false,
          emailConfidence: {
            in: [LeadEmailConfidence.VALID, LeadEmailConfidence.PROBABLE],
          },
          status: {
            notIn: [LeadStatus.DISCARDED, LeadStatus.DUPLICATE],
          },
        },
      }),
      this.prisma.brandBusinessContact.count({
        where: {
          commercialRelevance: {
            in: [CommercialRelevance.HIGH, CommercialRelevance.NEUTRAL],
          },
        },
      }),
      this.loadEmailAccountCounts(),
      this.prisma.influencer.findMany({
        where: { idealBrandProfile: { status: IbpStatus.FAILED } },
        select: { id: true, name: true },
        orderBy: { updatedAt: 'desc' },
        take: 3,
      }),
      this.prisma.influencer.findMany({
        where: {
          OR: [
            { idealBrandProfile: null },
            { idealBrandProfile: { status: IbpStatus.DRAFT } },
          ],
        },
        select: { id: true, name: true },
        orderBy: { updatedAt: 'desc' },
        take: 3,
      }),
      this.prisma.brandCandidate.findMany({
        where: {
          status: BrandCandidateStatus.APPROVED,
          leads: { none: {} },
          brandBusinessContacts: { none: {} },
        },
        select: {
          id: true,
          name: true,
          influencerId: true,
          influencer: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 2,
      }),
      this.prisma.brandDiscoveryRun.findMany({
        where: { status: BrandDiscoveryStatus.FAILED },
        select: {
          id: true,
          influencerId: true,
          influencer: { select: { name: true } },
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 2,
      }),
      this.prisma.leadDiscoveryRun.findMany({
        where: { status: LeadDiscoveryStatus.FAILED },
        select: {
          id: true,
          influencerId: true,
          influencer: { select: { name: true } },
          brandCandidate: { select: { name: true } },
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 2,
      }),
    ]);

    const attention = this.buildAttention({
      failedIbps,
      needingIbpTalents,
      brandsUnderReview,
      approvedNoContactSamples,
      failedBrandRuns,
      failedLeadRuns,
      emailDisconnected: emailCounts?.disconnected ?? null,
    });

    return {
      metrics: {
        talentsActiveIbp,
        talentsNeedingIbp: Math.max(0, totalTalents - talentsActiveIbp),
        brandsUnderReview,
        approvedWithoutContacts,
        readyContacts: readyLeads + readyBusinessContacts,
        emailAccountsConnected: emailCounts?.connected ?? null,
        emailAccountsDisconnected: emailCounts?.disconnected ?? null,
      },
      attention,
    };
  }

  private async loadEmailAccountCounts(): Promise<{
    connected: number;
    disconnected: number;
  } | null> {
    try {
      const page = await this.emailAccounts.list({ page: 1, limit: 1 });
      return {
        connected: page.counts.connected,
        disconnected: page.counts.disconnected,
      };
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'dashboard_email_accounts_unavailable',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return null;
    }
  }

  private buildAttention(input: {
    failedIbps: Array<{ id: string; name: string }>;
    needingIbpTalents: Array<{ id: string; name: string }>;
    brandsUnderReview: number;
    approvedNoContactSamples: Array<{
      id: string;
      name: string;
      influencerId: string;
      influencer: { name: string };
    }>;
    failedBrandRuns: Array<{
      id: string;
      influencerId: string;
      influencer: { name: string };
      updatedAt: Date;
    }>;
    failedLeadRuns: Array<{
      id: string;
      influencerId: string;
      influencer: { name: string };
      brandCandidate: { name: string };
      updatedAt: Date;
    }>;
    emailDisconnected: number | null;
  }): DashboardAttentionItem[] {
    const items: DashboardAttentionItem[] = [];

    for (const talent of input.failedIbps) {
      if (items.length >= ATTENTION_LIMIT) break;
      items.push({
        id: `ibp-failed-${talent.id}`,
        type: 'IBP_FAILED',
        title: `IBP failed for ${talent.name}`,
        count: 1,
        href: `/dashboard/creators/${talent.id}`,
        entityId: talent.id,
        entityLabel: talent.name,
      });
    }

    for (const talent of input.needingIbpTalents) {
      if (items.length >= ATTENTION_LIMIT) break;
      items.push({
        id: `ibp-draft-${talent.id}`,
        type: 'IBP_DRAFT',
        title: `IBP needed for ${talent.name}`,
        count: 1,
        href: `/dashboard/creators/${talent.id}`,
        entityId: talent.id,
        entityLabel: talent.name,
      });
    }

    if (input.brandsUnderReview > 0 && items.length < ATTENTION_LIMIT) {
      items.push({
        id: 'brands-under-review',
        type: 'BRANDS_UNDER_REVIEW',
        title: `${input.brandsUnderReview} brands awaiting review`,
        count: input.brandsUnderReview,
        href: '/dashboard/brand-discovery',
      });
    }

    for (const brand of input.approvedNoContactSamples) {
      if (items.length >= ATTENTION_LIMIT) break;
      items.push({
        id: `approved-no-contacts-${brand.id}`,
        type: 'APPROVED_NO_CONTACTS',
        title: `${brand.name} (approved, no contacts)`,
        count: 1,
        href: `/dashboard/creators/${brand.influencerId}`,
        entityId: brand.id,
        entityLabel: brand.name,
      });
    }

    const failedRuns = [
      ...input.failedBrandRuns.map((run) => ({
        id: `brand-run-failed-${run.id}`,
        type: 'DISCOVERY_FAILED' as const,
        title: `Brand discovery failed for ${run.influencer.name}`,
        href: `/dashboard/creators/${run.influencerId}`,
        entityId: run.id,
        entityLabel: run.influencer.name,
        updatedAt: run.updatedAt,
      })),
      ...input.failedLeadRuns.map((run) => ({
        id: `lead-run-failed-${run.id}`,
        type: 'DISCOVERY_FAILED' as const,
        title: `Contact discovery failed for ${run.brandCandidate.name}`,
        href: `/dashboard/creators/${run.influencerId}`,
        entityId: run.id,
        entityLabel: run.brandCandidate.name,
        updatedAt: run.updatedAt,
      })),
    ]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 2);

    for (const run of failedRuns) {
      if (items.length >= ATTENTION_LIMIT) break;
      items.push({
        id: run.id,
        type: run.type,
        title: run.title,
        count: 1,
        href: run.href,
        entityId: run.entityId,
        entityLabel: run.entityLabel,
      });
    }

    if (
      input.emailDisconnected != null &&
      input.emailDisconnected > 0 &&
      items.length < ATTENTION_LIMIT
    ) {
      items.push({
        id: 'email-disconnected',
        type: 'EMAIL_DISCONNECTED',
        title: `${input.emailDisconnected} email accounts disconnected`,
        count: input.emailDisconnected,
        href: '/dashboard/campaigns',
      });
    }

    return items.slice(0, ATTENTION_LIMIT);
  }
}
