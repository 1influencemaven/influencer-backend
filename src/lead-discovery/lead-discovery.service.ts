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
  LeadDiscoveryStatus,
  LeadEmailConfidence,
  LeadStatus,
} from '../generated/prisma/enums';
import { AiPromptsService } from '../ai-prompts/ai-prompts.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeDomain } from '../brand-discovery/utils/brand-domain.util';
import { SearchLeadsDto } from './dto/search-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import type { FindLeadsJobData } from './interfaces/find-leads-job.interface';
import {
  assertOptionIds,
  isAutonomousLeadProvider,
  LeadSourceRegistry,
} from './lead-source.registry';
import { AI_BRIGHTDATA_PROVIDER_ID } from './providers/ai-plus-brightdata.lead-source';
import { assessEmailConfidence } from './utils/email-confidence.util';
import { isGenericEmail } from './utils/generic-email.util';
import { sortContactsByTitlePriority } from './utils/title-priority.util';

export const leadDiscoveryRunSelect = {
  id: true,
  brandCandidateId: true,
  influencerId: true,
  status: true,
  providerId: true,
  providerOptions: true,
  limit: true,
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

@Injectable()
export class LeadDiscoveryService {
  private readonly logger = new Logger(LeadDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly leadSourceRegistry: LeadSourceRegistry,
    private readonly aiPromptsService: AiPromptsService,
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
      ...(promptInstructions
        ? { promptInstructionsSnapshot: true }
        : {}),
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
    return this.prisma.lead.findMany({
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
  }

  async updateLeadStatus(id: string, dto: UpdateLeadStatusDto) {
    const existing = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Lead ${id} not found`);
    }

    return this.prisma.lead.update({
      where: { id },
      data: { status: dto.status },
      select: leadSelect,
    });
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
      const optionIds = autonomous
        ? ['autonomous']
        : (options.optionIds ?? []);

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

      const rawContacts = await provider.findContacts({
        brandName: run.brandCandidate.name,
        website: run.brandCandidate.website,
        domain,
        limit: run.limit,
        optionIds,
        promptInstructions: instructions,
      });

      const existing = await this.prisma.lead.findMany({
        where: { brandCandidateId: run.brandCandidateId },
        select: { email: true },
      });
      const existingEmails = new Set(
        existing.map((lead) => lead.email.toLowerCase()),
      );

      const enriched = rawContacts
        .map((contact) => {
          const email = contact.email.trim().toLowerCase();
          const isGeneric = isGenericEmail(email);
          return {
            ...contact,
            email,
            isGeneric,
            emailConfidence: assessEmailConfidence(email, domain),
          };
        })
        .filter((contact) => {
          if (existingEmails.has(contact.email)) {
            return false;
          }
          if (contact.emailConfidence === LeadEmailConfidence.INVALID) {
            return false;
          }
          return true;
        });

      const sorted = sortContactsByTitlePriority(enriched).slice(0, run.limit);

      await this.prisma.$transaction(async (tx) => {
        if (sorted.length > 0) {
          await tx.lead.createMany({
            data: sorted.map((contact) => ({
              brandCandidateId: run.brandCandidateId,
              influencerId: run.influencerId,
              runId: run.id,
              contactName: contact.contactName,
              title: contact.title,
              email: contact.email,
              emailConfidence: contact.emailConfidence,
              isGeneric: contact.isGeneric,
              profileUrl: contact.profileUrl,
              providerId: run.providerId,
              sourceOptionId: contact.sourceOptionId,
              fitReason: contact.fitReason,
              source: contact.source,
              status: LeadStatus.UNDER_REVIEW,
              metadata: (contact.metadata ?? undefined) as
                | Prisma.InputJsonValue
                | undefined,
            })),
          });
        }

        await tx.leadDiscoveryRun.update({
          where: { id: run.id },
          data: {
            status: LeadDiscoveryStatus.COMPLETED,
            errorMessage: null,
          },
        });
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
}
