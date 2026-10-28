import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '../generated/prisma/client';

import { PROSPECTING_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import {
  BrandCandidateStatus,
  ContactChannelSource,
  ContactChannelType,
  LeadDiscoveryStatus,
  LeadEmailConfidence,
  LeadStatus,
} from '../generated/prisma/enums';
import { AiPromptsService } from '../ai-prompts/ai-prompts.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeDomain } from '../brand-discovery/utils/brand-domain.util';
import { SearchLeadsDto } from './dto/search-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import type { AddContactChannelDto } from './dto/add-contact-channel.dto';
import {
  ContactChannelService,
  contactChannelSelect,
  type CreateChannelInput,
} from './contact-channel.service';
import { normalizeChannelValue } from './utils/contact-channel-normalize.util';
import type { OutreachReadiness } from './utils/outreach-readiness.util';
import type { FindLeadsJobData } from './interfaces/find-leads-job.interface';
import {
  assertOptionIds,
  isAutonomousLeadProvider,
  LeadSourceRegistry,
} from './lead-source.registry';
import { AI_BRIGHTDATA_PROVIDER_ID } from './providers/ai-plus-brightdata.lead-source';
import { assessEmailConfidence } from './utils/email-confidence.util';
import { isGenericEmail } from './utils/generic-email.util';
import { toProfilePublicEmailInput } from './utils/profile-public-email-input.util';
import { sortContactsByTitlePriority } from './utils/title-priority.util';
import { PublicEmailEvidenceDiscoveryService } from './email-discovery/public-email-evidence-discovery.service';
import { BrandBusinessContactDiscoveryService } from './brand-business-contact-discovery.service';
import { BrandBusinessContactService } from './brand-business-contact.service';
import type {
  BusinessContactDiscoverySummary,
  LeadSearchMetadata,
  RawLeadContact,
} from './interfaces/lead-source-provider.interface';
import { classifyLeadDiscoveryOutcome } from './utils/lead-discovery-outcome.util';

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
  private readonly logger = new Logger(LeadDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly leadSourceRegistry: LeadSourceRegistry,
    private readonly aiPromptsService: AiPromptsService,
    private readonly contactChannelService: ContactChannelService,
    private readonly publicEmailEvidence: PublicEmailEvidenceDiscoveryService,
    private readonly brandBusinessContactDiscovery: BrandBusinessContactDiscoveryService,
    private readonly brandBusinessContactService: BrandBusinessContactService,
    @InjectQueue(QUEUES.PROSPECTING)
    private readonly prospectingQueue: Queue,
  ) {}

  listProviders() {
    return this.leadSourceRegistry.listSources();
  }

  listProviderOptions(providerId: string) {
    return this.leadSourceRegistry.listOptions(providerId);
  }

  async search(dto: SearchLeadsDto) {
    const requestedProviderId =
      dto.providerId?.trim() ||
      this.leadSourceRegistry.getDefault() ||
      AI_BRIGHTDATA_PROVIDER_ID;
    const { id: providerId, provider } =
      this.leadSourceRegistry.resolve(requestedProviderId);

    const availableOptions = await provider.listOptions();
    const autonomous = isAutonomousLeadProvider(providerId);
    const optionIds = autonomous
      ? ['autonomous']
      : (dto.options?.optionIds ?? []);

    if (!autonomous) {
      assertOptionIds(optionIds);
      const availableIds = new Set(availableOptions.map((o) => o.id));
      const unknown = optionIds.filter((id) => !availableIds.has(id));
      if (unknown.length > 0 && availableOptions.length > 0) {
        throw new BadRequestException(
          `Unknown provider options: ${unknown.join(', ')}`,
        );
      }
    }

    const limit =
      dto.limit ??
      Number(this.configService.get<number>('LEAD_DISCOVERY_LIMIT') ?? 10);

    const promptInstructions = autonomous
      ? await this.aiPromptsService.getLeadDiscoveryInstructions()
      : undefined;

    const providerOptions = {
      optionIds,
      optionNames: availableOptions
        .filter((o) => optionIds.includes(o.id))
        .map((o) => ({ id: o.id, name: o.name })),
      ...(promptInstructions ? { promptInstructionsSnapshot: true } : {}),
    };

    const runs: Array<{
      id: string;
      brandCandidateId: string;
      influencerId: string;
      status: LeadDiscoveryStatus;
      providerId: string;
      providerOptions: Prisma.JsonValue;
      limit: number;
      errorMessage: string | null;
      createdAt: Date;
      updatedAt: Date;
      brandCandidate: {
        id: string;
        name: string;
        website: string;
        domain: string;
        status: BrandCandidateStatus;
      };
      influencer: { id: string; name: string };
    }> = [];

    for (const brandCandidateId of dto.brandCandidateIds) {
      const candidate = await this.prisma.brandCandidate.findUnique({
        where: { id: brandCandidateId },
        select: {
          id: true,
          name: true,
          website: true,
          domain: true,
          status: true,
          influencerId: true,
        },
      });

      if (!candidate) {
        throw new NotFoundException(
          `Brand candidate ${brandCandidateId} not found`,
        );
      }

      if (candidate.status !== BrandCandidateStatus.APPROVED) {
        throw new BadRequestException(
          `Brand candidate ${candidate.name} must be APPROVED`,
        );
      }

      const processing = await this.prisma.leadDiscoveryRun.findFirst({
        where: {
          brandCandidateId,
          status: LeadDiscoveryStatus.PROCESSING,
        },
        select: { id: true },
      });

      if (processing) {
        throw new ConflictException(
          `Lead discovery already in progress for brand ${candidate.name}`,
        );
      }

      const run = await this.prisma.leadDiscoveryRun.create({
        data: {
          brandCandidateId,
          influencerId: candidate.influencerId,
          status: LeadDiscoveryStatus.PROCESSING,
          providerId,
          providerOptions,
          limit,
        },
        select: leadDiscoveryRunSelect,
      });

      await this.prospectingQueue.add(PROSPECTING_JOBS.FIND_LEADS, {
        runId: run.id,
        brandCandidateId,
        influencerId: candidate.influencerId,
        providerId,
        ...(promptInstructions ? { promptInstructions } : {}),
      } satisfies FindLeadsJobData);

      runs.push(run);
    }

    return {
      message: 'Lead discovery jobs enqueued',
      runs,
    };
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

    return this.withSelectedForOutreach(leads);
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

  async executeDiscovery(
    runId: string,
    promptInstructions?: string,
  ): Promise<void> {
    const run = await this.prisma.leadDiscoveryRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        brandCandidateId: true,
        influencerId: true,
        providerId: true,
        providerOptions: true,
        limit: true,
        status: true,
        brandCandidate: {
          select: {
            id: true,
            name: true,
            website: true,
            domain: true,
            status: true,
          },
        },
      },
    });

    if (!run) {
      throw new NotFoundException(`Lead discovery run ${runId} not found`);
    }

    if (run.status !== LeadDiscoveryStatus.PROCESSING) {
      this.logger.warn(`Run ${runId} is not PROCESSING; skipping`);
      return;
    }

    try {
      if (run.brandCandidate.status !== BrandCandidateStatus.APPROVED) {
        throw new BadRequestException(
          `Brand candidate ${run.brandCandidate.name} is no longer APPROVED`,
        );
      }

      const { provider } = this.leadSourceRegistry.resolve(run.providerId);
      const options = run.providerOptions as { optionIds?: string[] };
      const autonomous = isAutonomousLeadProvider(run.providerId);
      const optionIds = autonomous ? ['autonomous'] : (options.optionIds ?? []);

      if (!autonomous) {
        assertOptionIds(optionIds);
      }

      const instructions =
        promptInstructions?.trim() ||
        (autonomous
          ? await this.aiPromptsService.getLeadDiscoveryInstructions()
          : undefined);

      const domain =
        run.brandCandidate.domain ||
        normalizeDomain(run.brandCandidate.website);

      let businessContactDiscovery: BusinessContactDiscoverySummary | undefined;
      try {
        const discovery = await this.brandBusinessContactDiscovery.discover({
          brandCandidateId: run.brandCandidateId,
          website: run.brandCandidate.website,
          domain,
        });
        let contactsCreated = 0;
        let contactsUpdated = 0;
        for (const candidate of discovery.candidates) {
          const result =
            await this.brandBusinessContactService.upsertFromDiscovery({
              brandCandidateId: run.brandCandidateId,
              email: candidate.emailNormalized,
              sourceUrl: candidate.sourceUrl,
              evidenceSnippet: candidate.evidenceSnippet,
              commercialRelevance: candidate.commercialRelevance,
              isGeneric: candidate.isGeneric,
            });
          if (result.created) {
            contactsCreated += 1;
          } else if (result.updated) {
            contactsUpdated += 1;
          }
        }
        businessContactDiscovery = {
          ...discovery.summary,
          contactsCreated,
          contactsUpdated,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          JSON.stringify({
            event: 'brand_business_contact_discovery_failed',
            runId: run.id,
            error: message,
          }),
        );
        businessContactDiscovery = {
          pagesAttempted: 0,
          pagesSucceeded: 0,
          pagesFailed: 0,
          emailsFound: 0,
          contactsCreated: 0,
          contactsUpdated: 0,
        };
      }

      const { contacts: rawContacts, searchMetadata: peopleSearchMetadata } =
        await provider.findContacts({
          brandName: run.brandCandidate.name,
          website: run.brandCandidate.website,
          domain,
          limit: run.limit,
          optionIds,
          promptInstructions: instructions,
        });

      const existing = await this.prisma.lead.findMany({
        where: { brandCandidateId: run.brandCandidateId },
        select: {
          email: true,
          profileUrl: true,
          contactChannels: {
            select: { type: true, valueNormalized: true },
          },
        },
      });
      const existingEmails = new Set<string>();
      const existingLinkedIn = new Set<string>();
      for (const lead of existing) {
        if (lead.email) {
          existingEmails.add(lead.email.toLowerCase());
        }
        if (lead.profileUrl) {
          existingLinkedIn.add(
            normalizeChannelValue(
              ContactChannelType.LINKEDIN,
              lead.profileUrl,
            ),
          );
        }
        for (const channel of lead.contactChannels) {
          if (channel.type === ContactChannelType.EMAIL) {
            existingEmails.add(channel.valueNormalized);
          }
          if (channel.type === ContactChannelType.LINKEDIN) {
            existingLinkedIn.add(channel.valueNormalized);
          }
        }
      }

      const enriched = rawContacts
        .map((contact) => {
          const email = contact.email?.trim().toLowerCase();
          const isGeneric = email ? isGenericEmail(email) : false;
          return {
            ...contact,
            email,
            isGeneric,
            emailConfidence: email
              ? assessEmailConfidence(email, domain)
              : LeadEmailConfidence.UNKNOWN,
          };
        })
        .filter((contact) => {
          const email = contact.email;
          const profileUrl = contact.profileUrl?.trim();
          const profileNormalized = profileUrl
            ? normalizeChannelValue(ContactChannelType.LINKEDIN, profileUrl)
            : undefined;

          if (!email && !profileNormalized) {
            return false;
          }
          if (email && existingEmails.has(email)) {
            return false;
          }
          if (profileNormalized && existingLinkedIn.has(profileNormalized)) {
            return false;
          }
          if (
            email &&
            contact.emailConfidence === LeadEmailConfidence.INVALID
          ) {
            return false;
          }
          return true;
        });

      const sorted = sortContactsByTitlePriority(enriched).slice(0, run.limit);

      const createdLeads: Array<{ leadId: string; contact: RawLeadContact }> =
        [];

      await this.prisma.$transaction(async (tx) => {
        for (const contact of sorted) {
          const lead = await tx.lead.create({
            data: {
              brandCandidateId: run.brandCandidateId,
              influencerId: run.influencerId,
              runId: run.id,
              contactName: contact.contactName,
              title: contact.title,
              email: contact.email ?? null,
              emailConfidence: contact.emailConfidence,
              isGeneric: contact.isGeneric,
              profileUrl: contact.profileUrl ?? null,
              providerId: run.providerId,
              sourceOptionId: contact.sourceOptionId,
              fitReason: contact.fitReason,
              source: contact.source,
              status: LeadStatus.UNDER_REVIEW,
              metadata: (contact.metadata ?? undefined) as
                | Prisma.InputJsonValue
                | undefined,
            },
          });

          const channels: CreateChannelInput[] = [];
          if (contact.profileUrl?.trim()) {
            channels.push({
              type: ContactChannelType.LINKEDIN,
              value: contact.profileUrl.trim(),
              source: ContactChannelSource.LINKEDIN_SCRAPER,
            });
          }
          if (contact.email) {
            channels.push({
              type: ContactChannelType.EMAIL,
              value: contact.email,
              source: ContactChannelSource.LINKEDIN_SCRAPER,
              isGeneric: contact.isGeneric,
            });
          }
          if (channels.length > 0) {
            await this.contactChannelService.createChannelsForLead(
              tx,
              lead.id,
              channels,
            );
          }

          createdLeads.push({ leadId: lead.id, contact });
        }
      });

      for (const { leadId, contact } of createdLeads) {
        if (!contact.profileUrl?.trim()) {
          continue;
        }

        try {
          const input = toProfilePublicEmailInput(contact);
          const result = await this.publicEmailEvidence.discoverForProfile(input);
          const stats = await this.prisma.$transaction((tx) =>
            this.contactChannelService.persistPublicEmailEnrichment(
              tx,
              leadId,
              result,
            ),
          );

          this.logger.log(
            JSON.stringify({
              event: 'contact_channels_enriched',
              runId: run.id,
              leadId,
              contactName: contact.contactName,
              channelsAdded: stats.channelsAdded,
              genericEmails: stats.genericEmails,
              nonGenericEmails: stats.nonGenericEmails,
              pagesAttempted: stats.pagesAttempted,
              pagesSucceeded: stats.pagesSucceeded,
              errors: stats.errors,
            }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            JSON.stringify({
              event: 'public_email_enrichment_failed',
              runId: run.id,
              leadId,
              contactName: contact.contactName,
              error: message,
            }),
          );
        }
      }

      const personLeadsCreated = createdLeads.length;
      const businessContactsCreated =
        businessContactDiscovery?.contactsCreated ?? 0;

      const classification = classifyLeadDiscoveryOutcome({
        leadsPersisted: personLeadsCreated,
        businessContactsCreated,
        businessContactDiscovery,
        peopleSearchTrace: peopleSearchMetadata?.peopleSearchTrace,
      });

      const searchMetadata = this.mergeSearchMetadata(
        peopleSearchMetadata,
        businessContactDiscovery,
        classification,
        { personLeadsCreated, businessContactsCreated },
      );

      await this.prisma.leadDiscoveryRun.update({
        where: { id: run.id },
        data: {
          status: LeadDiscoveryStatus.COMPLETED,
          errorMessage: null,
          ...(searchMetadata
            ? {
                searchMetadata:
                  searchMetadata as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Lead discovery failed for run ${runId}: ${message}`);
      await this.prisma.leadDiscoveryRun.update({
        where: { id: runId },
        data: {
          status: LeadDiscoveryStatus.FAILED,
          errorMessage: message.slice(0, 2000),
        },
      });
      throw error;
    }
  }

  private mergeSearchMetadata(
    peopleSearchMetadata: LeadSearchMetadata | null,
    businessContactDiscovery: BusinessContactDiscoverySummary | undefined,
    classification: ReturnType<typeof classifyLeadDiscoveryOutcome>,
    counts: {
      personLeadsCreated: number;
      businessContactsCreated: number;
    },
  ): LeadSearchMetadata | null {
    const attempted2A = Boolean(businessContactDiscovery);
    const countFields = {
      personLeadsCreated: counts.personLeadsCreated,
      businessContactsCreated: counts.businessContactsCreated,
    };
    if (!peopleSearchMetadata && !attempted2A) {
      return {
        strategy: 'unknown',
        tracks: ['2B'],
        priorityRoles: [],
        scraperIds: [],
        plannedQueriesCount: 0,
        validatedQueriesCount: 0,
        queries: [],
        fallbackUsed: false,
        fallbackReason: null,
        searchHitsCount: 0,
        outcome: classification.outcome,
        warningCode: classification.warningCode,
        warningMessage: classification.warningMessage,
        ...countFields,
      };
    }

    const tracks: Array<'2A' | '2B' | '2C'> = [];
    if (attempted2A) {
      tracks.push('2A');
    }
    tracks.push('2B');

    const outcomeFields = {
      outcome: classification.outcome,
      warningCode: classification.warningCode,
      warningMessage: classification.warningMessage,
      ...countFields,
    };

    if (peopleSearchMetadata) {
      return {
        ...peopleSearchMetadata,
        tracks,
        ...outcomeFields,
        ...(attempted2A ? { businessContactDiscovery } : {}),
      };
    }

    return {
      strategy: 'unknown',
      tracks,
      priorityRoles: [],
      scraperIds: [],
      plannedQueriesCount: 0,
      validatedQueriesCount: 0,
      queries: [],
      fallbackUsed: false,
      fallbackReason: null,
      searchHitsCount: 0,
      ...outcomeFields,
      ...(attempted2A ? { businessContactDiscovery } : {}),
    };
  }
}
