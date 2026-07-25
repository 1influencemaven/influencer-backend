import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '../generated/prisma/client';

import { AiPromptsService } from '../ai-prompts/ai-prompts.service';
import { PROSPECTING_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import {
  BrandCandidateStatus,
  BrandDiscoveryStatus,
  IbpStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { BrandSourceRegistry } from './brand-source.registry';
import { SearchBrandsDto } from './dto/search-brands.dto';
import { UpdateBrandCandidateStatusDto } from './dto/update-brand-candidate-status.dto';
import type { FindBrandsJobData } from './interfaces/find-brands-job.interface';
import type { IbpCriteriaSnapshot } from './interfaces/brand-source-provider.interface';
import {
  dedupeByDomain,
  normalizeDomain,
} from './utils/brand-domain.util';

export const brandDiscoveryRunSelect = {
  id: true,
  influencerId: true,
  status: true,
  source: true,
  limit: true,
  ibpSnapshot: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
  influencer: {
    select: { id: true, name: true },
  },
} as const;

export const brandCandidateSelect = {
  id: true,
  influencerId: true,
  discoveryRunId: true,
  name: true,
  website: true,
  domain: true,
  sector: true,
  market: true,
  brandSize: true,
  score: true,
  fitReason: true,
  source: true,
  evidenceUrls: true,
  status: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  influencer: {
    select: { id: true, name: true },
  },
} as const;

@Injectable()
export class BrandDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly aiPromptsService: AiPromptsService,
    private readonly brandSourceRegistry: BrandSourceRegistry,
    @InjectQueue(QUEUES.PROSPECTING)
    private readonly prospectingQueue: Queue,
  ) {}

  async search(dto: SearchBrandsDto) {
    const { id: source } = this.brandSourceRegistry.resolve();
    const limit =
      dto.limit ??
      Number(this.configService.get<number>('BRAND_DISCOVERY_LIMIT') ?? 20);
    const promptInstructions =
      await this.aiPromptsService.getBrandDiscoveryInstructions();

    const runs: Array<{
      id: string;
      influencerId: string;
      status: BrandDiscoveryStatus;
      source: string;
      limit: number;
      ibpSnapshot: Prisma.JsonValue;
      errorMessage: string | null;
      createdAt: Date;
      updatedAt: Date;
      influencer: { id: string; name: string };
    }> = [];

    for (const influencerId of dto.influencerIds) {
      const influencer = await this.prisma.influencer.findUnique({
        where: { id: influencerId },
        select: {
          id: true,
          name: true,
          niche: true,
          idealBrandProfile: {
            select: {
              status: true,
              targetSectors: true,
              excludedSectors: true,
              brandSize: true,
              markets: true,
              collaborationTypes: true,
              summary: true,
              alertSignals: true,
              desirableCriteria: true,
            },
          },
        },
      });

      if (!influencer) {
        throw new NotFoundException(`Influencer ${influencerId} not found`);
      }

      if (!influencer.idealBrandProfile) {
        throw new BadRequestException(
          `Influencer ${influencer.name} has no ideal brand profile`,
        );
      }

      if (influencer.idealBrandProfile.status !== IbpStatus.ACTIVE) {
        throw new BadRequestException(
          `Influencer ${influencer.name} requires an ACTIVE ideal brand profile`,
        );
      }

      const processing = await this.prisma.brandDiscoveryRun.findFirst({
        where: {
          influencerId,
          status: BrandDiscoveryStatus.PROCESSING,
        },
        select: { id: true },
      });

      if (processing) {
        throw new ConflictException(
          `Brand discovery already in progress for influencer ${influencer.name}`,
        );
      }

      const ibpSnapshot: IbpCriteriaSnapshot = {
        targetSectors: influencer.idealBrandProfile.targetSectors,
        excludedSectors: influencer.idealBrandProfile.excludedSectors,
        brandSize: influencer.idealBrandProfile.brandSize,
        markets: influencer.idealBrandProfile.markets,
        collaborationTypes: influencer.idealBrandProfile.collaborationTypes,
        summary: influencer.idealBrandProfile.summary,
        alertSignals: influencer.idealBrandProfile.alertSignals,
        desirableCriteria: influencer.idealBrandProfile.desirableCriteria,
      };

      const run = await this.prisma.brandDiscoveryRun.create({
        data: {
          influencerId,
          status: BrandDiscoveryStatus.PROCESSING,
          source,
          limit,
          ibpSnapshot,
        },
        select: brandDiscoveryRunSelect,
      });

      await this.prospectingQueue.add(PROSPECTING_JOBS.FIND_BRANDS, {
        runId: run.id,
        influencerId,
        promptInstructions,
      } satisfies FindBrandsJobData);

      runs.push(run);
    }

    return {
      message: 'Brand discovery jobs enqueued',
      runs,
    };
  }

  async listRuns(influencerId?: string) {
    return this.prisma.brandDiscoveryRun.findMany({
      where: influencerId ? { influencerId } : undefined,
      select: brandDiscoveryRunSelect,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async listCandidates(filters: {
    influencerId?: string;
    runId?: string;
    status?: BrandCandidateStatus;
  }) {
    return this.prisma.brandCandidate.findMany({
      where: {
        influencerId: filters.influencerId,
        discoveryRunId: filters.runId,
        status: filters.status,
      },
      select: brandCandidateSelect,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async updateCandidateStatus(
    id: string,
    dto: UpdateBrandCandidateStatusDto,
  ) {
    const existing = await this.prisma.brandCandidate.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Brand candidate not found');
    }

    return this.prisma.brandCandidate.update({
      where: { id },
      data: { status: dto.status },
      select: brandCandidateSelect,
    });
  }

  async executeDiscovery(
    runId: string,
    influencerId: string,
    promptInstructions?: string,
  ) {
    const run = await this.prisma.brandDiscoveryRun.findUnique({
      where: { id: runId },
    });

    if (!run || run.influencerId !== influencerId) {
      throw new NotFoundException('Brand discovery run not found');
    }

    const influencer = await this.prisma.influencer.findUnique({
      where: { id: influencerId },
    });

    if (!influencer) {
      throw new NotFoundException('Influencer not found');
    }

    const ibp = run.ibpSnapshot as unknown as IbpCriteriaSnapshot;
    const instructions =
      promptInstructions?.trim() ||
      (await this.aiPromptsService.getBrandDiscoveryInstructions());
    const { provider: brandSource } = this.brandSourceRegistry.resolve();

    try {
      const rawCandidates = await brandSource.discover({
        influencerName: influencer.name,
        influencerNiche: influencer.niche,
        ibp,
        limit: run.limit,
        promptInstructions: instructions,
      });

      const filtered = this.applyHardFilters(rawCandidates, ibp);
      const unique = dedupeByDomain(filtered).slice(
        0,
        run.limit,
      ) as typeof filtered;

      await this.prisma.$transaction(async (tx) => {
        if (unique.length > 0) {
          await tx.brandCandidate.createMany({
            data: unique.map((candidate) => ({
              influencerId,
              discoveryRunId: runId,
              name: candidate.name,
              website: candidate.website,
              domain: candidate.domain || normalizeDomain(candidate.website),
              sector: candidate.sector,
              market: candidate.market,
              brandSize: candidate.brandSize,
              score: candidate.score,
              fitReason: candidate.fitReason,
              source: candidate.source,
              evidenceUrls: candidate.evidenceUrls,
              status: BrandCandidateStatus.UNDER_REVIEW,
            })),
          });
        }

        await tx.brandDiscoveryRun.update({
          where: { id: runId },
          data: { status: BrandDiscoveryStatus.COMPLETED },
        });
      });
    } catch (error) {
      await this.prisma.brandDiscoveryRun.update({
        where: { id: runId },
        data: {
          status: BrandDiscoveryStatus.FAILED,
          errorMessage:
            error instanceof Error ? error.message : 'Brand discovery failed',
        },
      });
      throw error;
    }
  }

  private applyHardFilters(
    candidates: Array<{
      name: string;
      website: string;
      domain: string;
      sector?: string;
      market?: string;
      brandSize?: string;
      score?: number;
      fitReason?: string;
      source: string;
      evidenceUrls: string[];
    }>,
    ibp: IbpCriteriaSnapshot,
  ) {
    const excluded = new Set(
      ibp.excludedSectors.map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    const markets = new Set(
      ibp.markets.map((m) => m.trim().toLowerCase()).filter(Boolean),
    );

    return candidates.filter((candidate) => {
      if (!candidate.website?.trim() || !candidate.name?.trim()) {
        return false;
      }

      const sector = candidate.sector?.trim().toLowerCase() ?? '';
      if (sector && [...excluded].some((ex) => sector.includes(ex))) {
        return false;
      }

      if (markets.size > 0 && candidate.market) {
        const market = candidate.market.trim().toLowerCase();
        const marketOk = [...markets].some(
          (allowed) => market.includes(allowed) || allowed.includes(market),
        );
        if (!marketOk) {
          return false;
        }
      }

      return true;
    });
  }
}

export type BrandDiscoveryRunRecord = Prisma.BrandDiscoveryRunGetPayload<{
  select: typeof brandDiscoveryRunSelect;
}>;

export type BrandCandidateRecord = Prisma.BrandCandidateGetPayload<{
  select: typeof brandCandidateSelect;
}>;
