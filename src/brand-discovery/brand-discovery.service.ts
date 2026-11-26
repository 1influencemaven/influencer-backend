import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '../generated/prisma/client';
import { isIbpCompatibleMarket } from './utils/ibp-market.util';
import {
  parseRetailerPolicy,
  selectForPersistence,
} from './utils/brand-retailer.util';
import {
  BrandKnowledgeService,
  type BrandDecisionStatus,
} from '../brand-knowledge/brand-knowledge.service';

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
import { BrandDiscoveryResearchService } from './brand-discovery-research.service';
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
import { filterBrandsByCommercialEligibility } from './utils/brand-commercial-eligibility.util';
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
  private readonly logger = new Logger(BrandDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly aiPromptsService: AiPromptsService,
    private readonly brandSourceRegistry: BrandSourceRegistry,
    private readonly brandDiscoveryAiOrchestrator: BrandDiscoveryAiOrchestrator,
    private readonly brandDiscoveryResearchService: BrandDiscoveryResearchService,
    @InjectQueue(QUEUES.PROSPECTING)
    private readonly prospectingQueue: Queue,
    /** Shared brand memory (BKB). Optional: absent in lightweight test modules. */
    @Optional()
    private readonly brandKnowledge?: BrandKnowledgeService,
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
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException('Brand candidate not found');
    }

    const updated = await this.prisma.brandCandidate.update({
      where: { id },
      data: { status: dto.status },
      select: brandCandidateSelect,
    });

    await this.feedBrandKnowledgeDecision(updated, existing.status);
    return updated;
  }

  /** Best-effort: never fails the review action. */
  /** Seeds from the shared base; BRAND_DISCOVERY_KNOWN_BRANDS=0 disables. */
  private async knownBrandSeeds(
    influencerId: string,
    influencer: {
      niche?: string | null;
      subNiche?: string | null;
      niches?: string[] | null;
    },
  ) {
    if (!this.brandKnowledge) return [];
    const raw = this.configService.get<string | number>('BRAND_DISCOVERY_KNOWN_BRANDS');
    const limit = raw === undefined || raw === '' ? 5 : Number(raw);
    if (!Number.isFinite(limit) || limit <= 0) return [];
    return this.brandKnowledge.suggestSeedBrands({
      influencerId,
      influencerTerms: [
        ...(influencer.niches ?? []),
        influencer.niche,
        influencer.subNiche,
      ],
      limit: Math.min(Math.floor(limit), 10),
    });
  }

  private async feedBrandKnowledgeDecision(
    candidate: {
      influencerId: string;
      name: string;
      website: string;
      domain: string;
      sector: string | null;
      market: string | null;
      brandSize: string | null;
      score: number | null;
      evidenceUrls: string[];
      evidenceStatus: string;
      source: string;
      status: string;
      metadata?: unknown;
    },
    previousStatus: string,
  ): Promise<void> {
    if (!this.brandKnowledge) return;
    try {
      const meta = (candidate.metadata ?? {}) as Record<string, unknown>;
      await this.brandKnowledge.recordDecision({
        candidate: {
          ...candidate,
          groundingSource:
            typeof meta.groundingSource === 'string'
              ? meta.groundingSource
              : null,
        },
        influencerTerms: await this.influencerNicheTerms(
          candidate.influencerId,
        ),
        from: previousStatus as BrandDecisionStatus,
        to: candidate.status as BrandDecisionStatus,
      });
    } catch (error) {
      this.logger.warn(
        `BKB decision feed failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async influencerNicheTerms(
    influencerId: string,
  ): Promise<Array<string | null>> {
    const influencer = await this.prisma.influencer.findUnique({
      where: { id: influencerId },
      select: { niche: true, subNiche: true, niches: true },
    });
    return influencer
      ? [influencer.niche, influencer.subNiche, ...influencer.niches]
      : [];
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
        // BKB read path: brands with a good track record for these niches are
        // scored again for this influencer (SEED_EVIDENCE, IBP still decides).
        const seedBrands = await this.knownBrandSeeds(influencerId, influencer);
        const orchestrated =
          await this.brandDiscoveryAiOrchestrator.orchestrate({
            runId,
            userId: BRAND_DISCOVERY_MASTRA_ACTOR_USER_ID,
            influencerId,
            influencerName: influencer.name,
            niche: influencer.niche,
            subNiche: influencer.subNiche,
            niches: influencer.niches,
            country: influencer.countries?.[0] ?? null,
            countries: influencer.countries ?? [],
            language: influencer.language,
            followers: influencer.followers,
            engagement:
              influencer.engagement != null
                ? Number(influencer.engagement)
                : null,
            ibp,
            limit: fetchLimit,
            promptInstructions: instructions,
            ...(seedBrands.length > 0
              ? {
                  seedBrands: seedBrands.map((seed) => ({
                    name: seed.name,
                    website: seed.website,
                    sector: seed.sector,
                    market: seed.market,
                    brandSize: seed.brandSize,
                    evidenceUrls: seed.evidenceUrls,
                  })),
                }
              : {}),
          });

        const commercial = filterBrandsByCommercialEligibility(
          orchestrated.brands,
        );
        const evidence = filterScoredBrandsByEvidence(commercial.eligible, {
          searchHits: orchestrated.searchHits,
          seedBrands,
        });

        const reasonCounts: Record<string, number> = {};
        for (const discarded of evidence.discarded) {
          reasonCounts[discarded.reason] =
            (reasonCounts[discarded.reason] ?? 0) + 1;
        }

        const programDomains = new Set(orchestrated.creatorProgramDomains ?? []);
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
            seedBrands,
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
            metadata:
              domain && programDomains.has(domain)
                ? {
                    ...((grounded.metadata as Record<string, unknown> | null) ??
                      {}),
                    // plan_v3 2A budget signal: active creator/ambassador program.
                    creatorProgram: true,
                  }
                : grounded.metadata,
          };
        };

        // VERIFIED and UNVERIFIED both continue to business filters (AI-004.5.3).
        // evidenceStatus + groundingSource set in Nest; Mastra never emits them.
        rawCandidates = [
          ...evidence.verified.map((b) => mapScored(b, 'VERIFIED')),
          ...evidence.unverified.map((b) => mapScored(b, 'UNVERIFIED')),
        ];

        const hardFilter = this.applyHardFiltersWithDiagnostics(
          rawCandidates,
          ibp,
        );
        const filtered = hardFilter.kept;
        const unique = dedupeByDomain(filtered) as typeof filtered;
        const novel = excludeExistingDomains(unique, existingDomains);
        // Prefer VERIFIED, then grounded UNVERIFIED (SEED). Never persist inventados
        // when SERP was empty, and never persist MODEL_PRIOR (foreign SERP ≠ domain claim).
        const orderedNovel = [
          ...novel.filter((c) => c.evidenceStatus === 'VERIFIED'),
          ...novel.filter((c) => c.evidenceStatus !== 'VERIFIED'),
        ];
        const skippedPersistNoSerp = orchestrated.searchHitsCount === 0;
        const withoutModelPrior = orderedNovel.filter(
          (c) => c.groundingSource !== 'MODEL_PRIOR',
        );
        const skippedModelPriorCount =
          orderedNovel.length - withoutModelPrior.length;
        // Multi-brand retailers are demoted (or excluded) BEFORE the limit so they
        // cannot displace brand-owned candidates; whatever the limit cuts is
        // recorded in searchMetadata instead of vanishing.
        const retailerPolicy = parseRetailerPolicy(
          this.configService.get<string>('BRAND_DISCOVERY_RETAILER_POLICY'),
        );
        const selection = selectForPersistence(
          withoutModelPrior,
          run.limit,
          retailerPolicy,
        );
        let toPersist = skippedPersistNoSerp ? [] : selection.selected;

        let researchedCount = 0;
        let researchFailedCount = 0;
        let researchPartialCount = 0;
        let researchConcurrency: number | undefined;

        if (toPersist.length > 0) {
          const enriched =
            await this.brandDiscoveryResearchService.enrichCandidates(
              toPersist,
              {
                runId,
                userId: BRAND_DISCOVERY_MASTRA_ACTOR_USER_ID,
                influencerId,
                influencerName: influencer.name,
                niche: influencer.niche,
                subNiche: influencer.subNiche,
                country: influencer.countries?.[0] ?? null,
                language: influencer.language,
                followers: influencer.followers,
                engagement:
                  influencer.engagement != null
                    ? Number(influencer.engagement)
                    : null,
                ibp,
                promptInstructions: instructions,
              },
            );
          toPersist = enriched.candidates;
          researchedCount = enriched.researchedCount;
          researchFailedCount = enriched.researchFailedCount;
          researchPartialCount = enriched.researchPartialCount;
          researchConcurrency = enriched.researchConcurrency;
        }

        searchMetadata = {
          engine: 'mastra',
          strategy: orchestrated.strategy,
          ...(orchestrated.creatorProgramQueries
            ? {
                creatorProgram: {
                  queries: orchestrated.creatorProgramQueries,
                  domainsFound: orchestrated.creatorProgramDomains?.length ?? 0,
                },
              }
            : {}),
          ...(seedBrands.length > 0
            ? {
                knownBrandSeeds: seedBrands.map((seed) => ({
                  website: seed.website,
                  nicheKey: seed.nicheKey,
                  approvedCount: seed.approvedCount,
                  avgScore: Math.round(seed.avgScore),
                })),
              }
            : {}),
          queries: orchestrated.queries,
          plannedQueriesCount: orchestrated.plannedQueriesCount,
          validatedQueriesCount: orchestrated.validatedQueriesCount,
          fallbackUsed: orchestrated.fallbackUsed,
          ...(orchestrated.planQueryValidation
            ? { planQueryValidation: orchestrated.planQueryValidation }
            : {}),
          serpQueryFallbackUsed: orchestrated.serpQueryFallbackUsed,
          geoLensesMode: orchestrated.geoLensesMode,
          ...(orchestrated.serpLenses
            ? { serpLenses: orchestrated.serpLenses }
            : {}),
          ...(orchestrated.unresolvedSerpRegions
            ? { unresolvedSerpRegions: orchestrated.unresolvedSerpRegions }
            : {}),
          ...(orchestrated.serpCallsPlanned != null
            ? { serpCallsPlanned: orchestrated.serpCallsPlanned }
            : {}),
          ...(orchestrated.serpCallsExecuted != null
            ? { serpCallsExecuted: orchestrated.serpCallsExecuted }
            : {}),
          ...(orchestrated.scoreBatches
            ? { scoreBatches: orchestrated.scoreBatches }
            : {}),
          ...(orchestrated.serpCallsOmitted != null
            ? { serpCallsOmitted: orchestrated.serpCallsOmitted }
            : {}),
          ...(orchestrated.serpCallsMax != null
            ? { serpCallsMax: orchestrated.serpCallsMax }
            : {}),
          ...(orchestrated.hitGeoAttribution
            ? { hitGeoAttribution: orchestrated.hitGeoAttribution }
            : {}),
          searchHitsCount: orchestrated.searchHitsCount,
          planExecutionId: orchestrated.planExecutionId,
          scoreExecutionId: orchestrated.scoreExecutionId,
          scoredBrandsCount: orchestrated.brands.length,
          commercialEligibleCount: commercial.eligible.length,
          commercialDiscardedCount: commercial.discarded.length,
          commercialDiscardReasons: commercial.discarded.reduce(
            (acc, row) => {
              const key = row.eligibility.reason;
              acc[key] = (acc[key] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
          verifiedCount: evidence.verified.length,
          unverifiedCount: evidence.unverified.length,
          discardedByEvidenceCount: evidence.discarded.length,
          evidenceAcceptedCount: evidence.verified.length,
          evidenceRejectedCount: evidence.discarded.length,
          evidenceRejectReasonCounts: reasonCounts,
          afterHardFiltersCount: filtered.length,
          hardFilterDiscarded: hardFilter.discarded.slice(0, 30),
          hardFilterReasonCounts: hardFilter.discarded.reduce(
            (acc, row) => {
              acc[row.reason] = (acc[row.reason] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
          afterDedupeCount: unique.length,
          afterExcludeExistingCount: novel.length,
          retailerPolicy,
          retailersSelectedCount: selection.retailersSelected.length,
          retailersExcluded: selection.retailersExcluded
            .slice(0, 30)
            .map((c) => ({ name: c.name, domain: c.domain, score: c.score })),
          cutByLimitCount: selection.cutByLimit.length,
          cutByLimit: selection.cutByLimit
            .slice(0, 30)
            .map((c) => ({ name: c.name, domain: c.domain, score: c.score })),
          skippedModelPriorCount,
          persistedCount: toPersist.length,
          researchedCount,
          researchFailedCount,
          researchPartialCount,
          ...(researchConcurrency != null ? { researchConcurrency } : {}),
          ...(skippedPersistNoSerp
            ? { skippedPersistReason: 'NO_SERP_HITS' as const }
            : skippedModelPriorCount > 0 && toPersist.length === 0
              ? {
                  skippedPersistReason:
                    'MODEL_PRIOR_WITHOUT_DOMAIN_EVIDENCE' as const,
                }
              : {}),
          serpDiagnostics: orchestrated.serpDiagnostics ?? [],
          serpHitFilter: orchestrated.serpHitFilter,
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

    // After commit and best-effort: BKB problems must not fail the run.
    if (this.brandKnowledge && toPersist.length > 0) {
      try {
        await this.brandKnowledge.recordSurfaced({
          influencerTerms: await this.influencerNicheTerms(influencerId),
          candidates: toPersist.map((candidate) => ({
            ...candidate,
            groundingSource: candidate.groundingSource ?? null,
          })),
        });
      } catch (error) {
        this.logger.warn(
          `BKB surfaced feed failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private applyHardFilters(
    candidates: RawBrandCandidate[],
    ibp: IbpCriteriaSnapshot,
  ) {
    return this.applyHardFiltersWithDiagnostics(candidates, ibp).kept;
  }

  /**
   * Same rules as before, but every rejection keeps its reason so a run that
   * loses all candidates here is explainable from `searchMetadata`.
   */
  private applyHardFiltersWithDiagnostics(
    candidates: RawBrandCandidate[],
    ibp: IbpCriteriaSnapshot,
  ): {
    kept: RawBrandCandidate[];
    discarded: Array<{
      name: string;
      domain: string;
      reason: 'missing_fields' | 'excluded_sector' | 'market_mismatch';
      sector?: string | null;
      market?: string | null;
    }>;
  } {
    const excluded = new Set(
      ibp.excludedSectors.map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    const markets = new Set(
      ibp.markets.map((m) => m.trim().toLowerCase()).filter(Boolean),
    );

    const kept: RawBrandCandidate[] = [];
    const discarded: Array<{
      name: string;
      domain: string;
      reason: 'missing_fields' | 'excluded_sector' | 'market_mismatch';
      sector?: string | null;
      market?: string | null;
    }> = [];
    const reject = (
      candidate: RawBrandCandidate,
      reason: 'missing_fields' | 'excluded_sector' | 'market_mismatch',
    ) =>
      discarded.push({
        name: candidate.name,
        domain: candidate.domain,
        reason,
        sector: candidate.sector,
        market: candidate.market,
      });

    for (const candidate of candidates) {
      if (!candidate.website?.trim() || !candidate.name?.trim()) {
        reject(candidate, 'missing_fields');
        continue;
      }

      const sector = candidate.sector?.trim().toLowerCase() ?? '';
      if (sector && [...excluded].some((ex) => sector.includes(ex))) {
        reject(candidate, 'excluded_sector');
        continue;
      }

      if (markets.size > 0 && candidate.market) {
        if (!isIbpCompatibleMarket(candidate.market, markets)) {
          reject(candidate, 'market_mismatch');
          continue;
        }
      }

      kept.push(candidate);
    }
    return { kept, discarded };
  }
}

export { isIbpCompatibleMarket };

export type BrandDiscoveryRunRecord = Prisma.BrandDiscoveryRunGetPayload<{
  select: typeof brandDiscoveryRunSelect;
}>;

export type BrandCandidateRecord = Prisma.BrandCandidateGetPayload<{
  select: typeof brandCandidateSelect;
}>;
