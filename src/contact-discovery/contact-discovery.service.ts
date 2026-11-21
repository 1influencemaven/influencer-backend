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
import { DbNull } from '../generated/prisma/internal/prismaNamespace';
import {
  BrandCandidateStatus,
  LeadDiscoveryStatus,
} from '../generated/prisma/enums';

import { CONTACT_DISCOVERY_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import {
  BBC_V1_DEFAULT_MAX_PAGES,
  MASTRA_CONTACT_EMAILS_PROVIDER_ID,
} from './constants';
import {
  contactDiscoveryJobId,
  type DiscoverBusinessContactsJobData,
} from './interfaces/discover-business-contacts-job.interface';

/** Mirrors leadDiscoveryRunSelect shape without importing LeadDiscoveryService (cycle). */
const bbcRunSelect = {
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
    select: {
      id: true,
      name: true,
      website: true,
      domain: true,
      status: true,
    },
  },
  influencer: {
    select: { id: true, name: true },
  },
} as const;

export type BbcSearchStartDto = {
  brandCandidateIds: string[];
  limit?: number;
};

/**
 * Application service for Contact Discovery BBC v1.
 * Creates LeadDiscoveryRun rows and enqueues `contact-discovery` jobs.
 * Does not call Bright Data directly (processor → orchestrator → port).
 */
@Injectable()
export class ContactDiscoveryService {
  private readonly logger = new Logger(ContactDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue(QUEUES.CONTACT_DISCOVERY)
    private readonly contactDiscoveryQueue: Queue,
  ) {}

  /**
   * Start Mastra FIND_BRAND_EMAILS discovery for APPROVED brands (Paso 5b).
   */
  async startBbcDiscovery(dto: BbcSearchStartDto) {
    const maxPages =
      this.configService.get<number>('MAX_BRAND_BUSINESS_CONTACT_PAGES') ??
      BBC_V1_DEFAULT_MAX_PAGES;

    const limit =
      dto.limit ??
      Number(this.configService.get<number>('LEAD_DISCOVERY_LIMIT') ?? 10);

    const providerId = MASTRA_CONTACT_EMAILS_PROVIDER_ID;
    const providerOptions = {
      mode: 'mastra-find-brand-emails',
      engine: 'mastra',
      searchConnected: true,
      autonomous: true,
    } as const;

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
        select: bbcRunSelect,
      });

      const jobData: DiscoverBusinessContactsJobData = {
        runId: run.id,
        brandCandidateId,
        influencerId: candidate.influencerId,
        website: candidate.website,
        domain: candidate.domain,
        maxPages,
      };

      try {
        await this.contactDiscoveryQueue.add(
          CONTACT_DISCOVERY_JOBS.DISCOVER_BUSINESS_CONTACTS,
          jobData,
          {
            jobId: contactDiscoveryJobId(run.id),
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          JSON.stringify({
            event: 'bbc_discovery_enqueue_failed',
            runId: run.id,
            brandCandidateId,
            errorMessage: message,
          }),
        );
        await this.prisma.leadDiscoveryRun.update({
          where: { id: run.id },
          data: {
            status: LeadDiscoveryStatus.FAILED,
            errorMessage: `BBC_ENQUEUE_FAILED: ${message}`,
            searchMetadata: DbNull,
          },
        });
        throw new ConflictException(
          `Failed to enqueue contact-discovery job for brand ${candidate.name}`,
        );
      }

      this.logger.log(
        JSON.stringify({
          event: 'bbc_discovery_enqueued',
          runId: run.id,
          brandCandidateId,
          queue: QUEUES.CONTACT_DISCOVERY,
          job: CONTACT_DISCOVERY_JOBS.DISCOVER_BUSINESS_CONTACTS,
          searchConnected: false,
        }),
      );

      runs.push(run);
    }

    return {
      message: 'Contact discovery BBC jobs enqueued',
      runs,
    };
  }
}
