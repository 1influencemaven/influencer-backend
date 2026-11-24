import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CONTACT_TIER_ORDER,
  leadContactTier,
} from './utils/contact-tier.util';
import type { Prisma } from '../generated/prisma/client';
import { LeadStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { SearchLeadsDto } from './dto/search-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import type { AddContactChannelDto } from './dto/add-contact-channel.dto';
import {
  ContactChannelService,
  contactChannelSelect,
} from './contact-channel.service';
import type { OutreachReadiness } from './utils/outreach-readiness.util';
import { ContactDiscoveryService } from '../contact-discovery/contact-discovery.service';
import {
  BBC_BRIGHTDATA_PROVIDER_ID,
  MASTRA_CONTACT_EMAILS_PROVIDER_ID,
} from '../contact-discovery/constants';

export const leadDiscoveryRunSelect = {
  id: true,
  brandCandidateId: true,
  influencerId: true,
  status: true,
  providerId: true,
  providerOptions: true,
  limit: true,
  searchMetadata: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
  brandCandidate: {
    select: { id: true, name: true, website: true, domain: true, status: true },
  },
  influencer: {
    select: { id: true, name: true },
  },
} as const;

export const leadSelect = {
  id: true,
  brandCandidateId: true,
  influencerId: true,
  runId: true,
  contactName: true,
  title: true,
  email: true,
  emailConfidence: true,
  isGeneric: true,
  profileUrl: true,
  providerId: true,
  sourceOptionId: true,
  fitReason: true,
  source: true,
  status: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  brandCandidate: {
    select: { id: true, name: true },
  },
  influencer: {
    select: { id: true, name: true },
  },
} as const;

export const leadDetailSelect = {
  ...leadSelect,
  brandCandidate: {
    select: { id: true, name: true, website: true },
  },
  contactChannels: {
    select: contactChannelSelect,
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

type LeadRow = {
  id: string;
  brandCandidateId: string;
  [key: string]: unknown;
};

@Injectable()
export class LeadDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contactChannelService: ContactChannelService,
    private readonly contactDiscoveryService: ContactDiscoveryService,
  ) {}

  listProviders() {
    return {
      available: [
        MASTRA_CONTACT_EMAILS_PROVIDER_ID,
        BBC_BRIGHTDATA_PROVIDER_ID,
      ],
      default: MASTRA_CONTACT_EMAILS_PROVIDER_ID,
      /** Always true after Paso 5b — BBC/Mastra is the only write path. */
      rebuildMode: true,
    };
  }

  listProviderOptions(providerId: string) {
    if (providerId === BBC_BRIGHTDATA_PROVIDER_ID) {
      return {
        providerId: BBC_BRIGHTDATA_PROVIDER_ID,
        options: [],
        autonomous: true,
        searchConnected: false,
        mode: 'bbc-v1-allowlist-html',
      };
    }
    return {
      providerId: MASTRA_CONTACT_EMAILS_PROVIDER_ID,
      options: [],
      autonomous: true,
      searchConnected: true,
      mode: 'mastra-find-brand-emails',
    };
  }

  async search(dto: SearchLeadsDto) {
    return this.contactDiscoveryService.startBbcDiscovery({
      brandCandidateIds: dto.brandCandidateIds,
      limit: dto.limit,
    });
  }

  async listRuns(filters: {
    brandCandidateId?: string;
    influencerId?: string;
  }) {
    return this.prisma.leadDiscoveryRun.findMany({
      where: {
        ...(filters.brandCandidateId
          ? { brandCandidateId: filters.brandCandidateId }
          : {}),
        ...(filters.influencerId ? { influencerId: filters.influencerId } : {}),
      },
      select: leadDiscoveryRunSelect,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async listLeads(filters: {
    brandCandidateId?: string;
    influencerId?: string;
    runId?: string;
    status?: LeadStatus;
  }) {
    const leads = await this.prisma.lead.findMany({
      where: {
        ...(filters.brandCandidateId
          ? { brandCandidateId: filters.brandCandidateId }
          : {}),
        ...(filters.influencerId ? { influencerId: filters.influencerId } : {}),
        ...(filters.runId ? { runId: filters.runId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      select: leadSelect,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const rows = await this.withSelectedForOutreach(leads);
    // Tier 1 first, then newest (strategy §3 priority for the 20/day quota).
    return rows
      .map((lead) => ({ ...lead, contactTier: leadContactTier(lead) }))
      .sort(
        (a, b) =>
          CONTACT_TIER_ORDER[a.contactTier] - CONTACT_TIER_ORDER[b.contactTier],
      );
  }

  async getLeadById(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      select: leadDetailSelect,
    });
    if (!lead) {
      throw new NotFoundException(`Lead ${id} not found`);
    }
    const [withFlag] = await this.withSelectedForOutreach([lead]);
    return this.toLeadDetailResponse(withFlag);
  }

  async addContactChannel(leadId: string, dto: AddContactChannelDto) {
    await this.contactChannelService.addChannel(leadId, dto);
    return this.getLeadById(leadId);
  }

  private toLeadDetailResponse(
    lead: Prisma.LeadGetPayload<{ select: typeof leadDetailSelect }> & {
      selectedForOutreach: boolean;
    },
  ) {
    const outreachReadiness: OutreachReadiness =
      this.contactChannelService.computeReadiness(lead.contactChannels);

    return {
      id: lead.id,
      brandCandidateId: lead.brandCandidateId,
      influencerId: lead.influencerId,
      runId: lead.runId,
      status: lead.status,
      selectedForOutreach: lead.selectedForOutreach,
      person: {
        name: lead.contactName,
        position: lead.title,
        company: lead.brandCandidate.name,
      },
      contactChannels: lead.contactChannels,
      outreachReadiness,
      email: lead.email,
      profileUrl: lead.profileUrl,
      emailConfidence: lead.emailConfidence,
      isGeneric: lead.isGeneric,
      contactTier: leadContactTier(lead),
      providerId: lead.providerId,
      sourceOptionId: lead.sourceOptionId,
      fitReason: lead.fitReason,
      source: lead.source,
      metadata: lead.metadata,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      brandCandidate: lead.brandCandidate,
      influencer: lead.influencer,
    };
  }

  async updateLeadStatus(id: string, dto: UpdateLeadStatusDto) {
    const existing = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true, brandCandidateId: true },
    });
    if (!existing) {
      throw new NotFoundException(`Lead ${id} not found`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id },
        data: { status: dto.status },
        select: leadSelect,
      });

      if (
        dto.status === LeadStatus.DISCARDED ||
        dto.status === LeadStatus.DUPLICATE
      ) {
        await tx.brandCandidate.updateMany({
          where: {
            id: existing.brandCandidateId,
            selectedLeadId: id,
          },
          data: { selectedLeadId: null },
        });
      }

      return lead;
    });

    const [withFlag] = await this.withSelectedForOutreach([updated]);
    return withFlag;
  }

  /**
   * Select an APPROVED lead as the exclusive outreach target for its brand.
   * Replaces any previous BrandCandidate.selectedLeadId (ADR-0011).
   */
  async selectLeadForOutreach(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, brandCandidateId: true, status: true },
    });
    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }
    if (lead.status !== LeadStatus.APPROVED) {
      throw new BadRequestException(
        `Only APPROVED leads can be selected for outreach (current status: ${lead.status})`,
      );
    }

    await this.prisma.brandCandidate.update({
      where: { id: lead.brandCandidateId },
      data: { selectedLeadId: lead.id },
    });

    const full = await this.prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: leadSelect,
    });
    return { ...full, selectedForOutreach: true };
  }

  /**
   * Clear BrandCandidate.selectedLeadId when this lead is the current selection.
   */
  async deselectLeadForOutreach(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        brandCandidateId: true,
        brandCandidate: { select: { selectedLeadId: true } },
      },
    });
    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }
    if (lead.brandCandidate.selectedLeadId !== lead.id) {
      throw new BadRequestException(
        `Lead ${leadId} is not the selected outreach lead for this brand`,
      );
    }

    await this.prisma.brandCandidate.update({
      where: { id: lead.brandCandidateId },
      data: { selectedLeadId: null },
    });

    const full = await this.prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: leadSelect,
    });
    return { ...full, selectedForOutreach: false };
  }

  private async withSelectedForOutreach<T extends LeadRow>(
    leads: T[],
  ): Promise<Array<T & { selectedForOutreach: boolean }>> {
    if (leads.length === 0) {
      return [];
    }

    const brandIds = [...new Set(leads.map((lead) => lead.brandCandidateId))];
    const brands = await this.prisma.brandCandidate.findMany({
      where: { id: { in: brandIds } },
      select: { id: true, selectedLeadId: true },
    });
    const selectedByBrand = new Map(
      brands.map((brand) => [brand.id, brand.selectedLeadId]),
    );

    return leads.map((lead) => ({
      ...lead,
      selectedForOutreach:
        selectedByBrand.get(lead.brandCandidateId) === lead.id,
    }));
  }

}
