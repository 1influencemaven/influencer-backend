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
  EvidenceStatus,
  IbpStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { BrandDiscoveryAiOrchestrator } from './brand-discovery-ai.orchestrator';
import { BrandSourceRegistry } from './brand-source.registry';
import { SearchBrandsDto } from './dto/search-brands.dto';
import { UpdateBrandCandidateStatusDto } from './dto/update-brand-candidate-status.dto';
import type { FindBrandsJobData } from './interfaces/find-brands-job.interface';
import type {
  BrandSearchMetadata,
  IbpCriteriaSnapshot,
  RawBrandCandidate,
} from './interfaces/brand-source-provider.interface';
import {
  dedupeByDomain,
  ensureWebsiteUrl,
  excludeExistingDomains,
  normalizeDomain,
} from './utils/brand-domain.util';
import { filterScoredBrandsByEvidence } from './utils/brand-evidence-filter.util';
import { enrichScoredBrandForPersistence } from './utils/brand-score-grounding.util';

/** Context.userId for Mastra requests when HTTP actor is not on the job payload. */
export const BRAND_DISCOVERY_MASTRA_ACTOR_USER_ID = 'system:brand-discovery';

export const brandDiscoveryRunSelect = {
  id: true,
  influencerId: true,
  status: true,
  source: true,
  limit: true,
  ibpSnapshot: true,
  searchMetadata: true,
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
  evidenceStatus: true,
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
    private readonly brandDiscoveryAiOrchestrator: BrandDiscoveryAiOrchestrator,
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
      searchMetadata: Prisma.JsonValue | null;
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

  async updateCandidateStatus(id: string, dto: UpdateBrandCandidateStatusDto) {
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

  async removeCandidate(id: string): Promise<void> {
    const existing = await this.prisma.brandCandidate.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Brand candidate not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.brandCandidate.update({
        where: { id },
        data: { selectedLeadId: null },
      });
      await tx.brandCandidate.delete({
        where: { id },
      });
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
    const engine = this.resolveEngine();

    try {
      const existingRows = await this.prisma.brandCandidate.findMany({
        where: { influencerId },
        select: { domain: true },
      });
      const existingDomains = new Set(
        existingRows.map((row) => normalizeDomain(row.domain)).filter(Boolean),
      );

      const fetchLimit = Math.min(Math.max(run.limit * 2, run.limit), 20);

      let rawCandidates: RawBrandCandidate[];
      let searchMetadata: BrandSearchMetadata | Record<string, unknown>;

      if (engine === 'mastra') {
        const orchestrated =
          await this.brandDiscoveryAiOrchestrator.orchestrate({
            runId,
            userId: BRAND_DISCOVERY_MASTRA_ACTOR_USER_ID,
            influencerId,
            influencerName: influencer.name,
            niche: influencer.niche,
            ibp,
            limit: fetchLimit,
            promptInstructions: instructions,
          });

        const evidence = filterScoredBrandsByEvidence(orchestrated.brands, {
          searchHits: orchestrated.searchHits,
        });

        const reasonCounts: Record<string, number> = {};
        for (const discarded of evidence.discarded) {
          reasonCounts[discarded.reason] =
            (reasonCounts[discarded.reason] ?? 0) + 1;
        }

        const mapScored = (
          brand: (typeof evidence.verified)[number],
          evidenceStatus: 'VERIFIED' | 'UNVERIFIED',
        ): RawBrandCandidate => {
          const website = ensureWebsiteUrl(brand.website);
          const domain = normalizeDomain(website);
          const grounded = enrichScoredBrandForPersistence({
            brand,
            evidenceStatus,
            searchHits: orchestrated.searchHits,
            seedBrands: undefined,
            ibp,
            website,
            domain,
          });
          return {
            name: grounded.name,
            website: grounded.website,
            domain: grounded.domain,
            sector: grounded.sector,
            market: grounded.market,
            brandSize: grounded.brandSize,
            score: grounded.score,
            fitReason: grounded.fitReason,
            source: 'mastra',
            evidenceUrls: grounded.evidenceUrls,
            evidenceStatus: grounded.evidenceStatus,
            groundingSource: grounded.groundingSource,
            metadata: grounded.metadata,
          };
        };

        // VERIFIED and UNVERIFIED both continue to business filters (AI-004.5.3).
        // evidenceStatus + groundingSource set in Nest; Mastra never emits them.
        rawCandidates = [
          ...evidence.verified.map((b) => mapScored(b, 'VERIFIED')),
          ...evidence.unverified.map((b) => mapScored(b, 'UNVERIFIED')),
        ];

        const filtered = this.applyHardFilters(rawCandidates, ibp);
        const unique = dedupeByDomain(filtered) as typeof filtered;
        const novel = excludeExistingDomains(unique, existingDomains);
        const toPersist = novel.slice(0, run.limit);

        searchMetadata = {
          engine: 'mastra',
          strategy: orchestrated.strategy,
          queries: orchestrated.queries,
          plannedQueriesCount: orchestrated.plannedQueriesCount,
          validatedQueriesCount: orchestrated.validatedQueriesCount,
          fallbackUsed: orchestrated.fallbackUsed,
          searchHitsCount: orchestrated.searchHitsCount,
          planExecutionId: orchestrated.planExecutionId,
          scoreExecutionId: orchestrated.scoreExecutionId,
          scoredBrandsCount: orchestrated.brands.length,
          verifiedCount: evidence.verified.length,
          unverifiedCount: evidence.unverified.length,
          discardedByEvidenceCount: evidence.discarded.length,
          evidenceAcceptedCount: evidence.verified.length,
          evidenceRejectedCount: evidence.discarded.length,
          evidenceRejectReasonCounts: reasonCounts,
          afterHardFiltersCount: filtered.length,
          afterDedupeCount: unique.length,
          afterExcludeExistingCount: novel.length,
          persistedCount: toPersist.length,
          serpDiagnostics: orchestrated.serpDiagnostics ?? [],
        };

        await this.persistDiscoveryResult({
          runId,
          influencerId,
          toPersist,
          searchMetadata,
        });
        return;
      }

      const { provider: brandSource } = this.brandSourceRegistry.resolve();
      const discovered = await brandSource.discover({
        influencerName: influencer.name,
        influencerNiche: influencer.niche,
        ibp,
        limit: fetchLimit,
        promptInstructions: instructions,
      });
      // Legacy has no Nest evidence classifier equivalent — always NOT_ASSESSED
      // (do not infer VERIFIED from evidenceUrls).
      rawCandidates = discovered.candidates.map((c) => ({
        ...c,
        evidenceStatus: 'NOT_ASSESSED' as const,
      }));

      const filtered = this.applyHardFilters(rawCandidates, ibp);
      const unique = dedupeByDomain(filtered) as typeof filtered;
      const novel = excludeExistingDomains(unique, existingDomains);
      const toPersist = novel.slice(0, run.limit);

      searchMetadata = discovered.searchMetadata
        ? { ...discovered.searchMetadata, engine: 'legacy' as const }
        : { engine: 'legacy' as const };

      await this.persistDiscoveryResult({
        runId,
        influencerId,
        toPersist,
        searchMetadata,
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

  private resolveEngine(): 'legacy' | 'mastra' {
    const value = this.configService.get<string>('BRAND_DISCOVERY_ENGINE');
    return value === 'mastra' ? 'mastra' : 'legacy';
  }

  private async persistDiscoveryResult(args: {
    runId: string;
    influencerId: string;
    toPersist: RawBrandCandidate[];
    searchMetadata: BrandSearchMetadata | Record<string, unknown>;
  }): Promise<void> {
    const { runId, influencerId, toPersist, searchMetadata } = args;

    await this.prisma.$transaction(async (tx) => {
      if (toPersist.length > 0) {
        await tx.brandCandidate.createMany({
          data: toPersist.map((candidate) => ({
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
            evidenceStatus:
              candidate.evidenceStatus === 'VERIFIED'
                ? EvidenceStatus.VERIFIED
                : candidate.evidenceStatus === 'UNVERIFIED'
                  ? EvidenceStatus.UNVERIFIED
                  : EvidenceStatus.NOT_ASSESSED,
            metadata:
              candidate.metadata != null
                ? (candidate.metadata as Prisma.InputJsonValue)
                : undefined,
            status: BrandCandidateStatus.UNDER_REVIEW,
          })),
        });
      }

      await tx.brandDiscoveryRun.update({
        where: { id: runId },
        data: {
          status: BrandDiscoveryStatus.COMPLETED,
          searchMetadata: searchMetadata as Prisma.InputJsonValue,
        },
      });
    });
  }

  private applyHardFilters(
    candidates: RawBrandCandidate[],
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
