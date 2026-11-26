import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  IbpCriteriaSnapshot,
  ScoredBrand,
} from '@influence-maven/ai-contracts';

import { AiPromptsService } from '../ai-prompts/ai-prompts.service';
import { buildBrandDiscoveryQueries } from '../ai/prompts/generate-brand-discovery.prompt';
import { AiExecutionPublisherService } from '../ai-execution/ai-execution-publisher.service';
import { AiExecutionWaitError } from '../ai-execution/ai-execution-result-wait.errors';
import { AiExecutionResultWaitService } from '../ai-execution/ai-execution-result-wait.service';
import type { BrandDiscoverySerpQueryDiagnostic } from './interfaces/brand-source-provider.interface';
import type { WebSearchHit } from './interfaces/web-search-provider.interface';
import { BrightDataSerpProviderError } from '../integrations/brightdata';
import {
  BrightDataWebSearchProvider,
  type WebSearchWithDiagnostics,
} from './providers/brightdata-web-search.provider';
import {
  BRAND_DISCOVERY_AI_ERROR_CODES,
  BrandDiscoveryAiOrchestratorError,
} from './brand-discovery-ai.orchestrator.errors';
import {
  BRAND_SEARCH_MAX_QUERIES,
  validateBrandSearchQueriesWithDiagnostics,
  type BrandSearchQueryValidationDiagnostics,
} from './utils/brand-search-queries.util';
import {
  filterBrandDiscoverySearchHitsWithDiagnostics,
  type SerpHitFilterDiagnostics,
} from './utils/brand-serp-hit-filter.util';
import { normalizeDomain } from './utils/brand-domain.util';
import { mapPool } from './utils/map-pool.util';
import {
  buildCreatorProgramQueries,
  mergeCreatorProgramHits,
} from './utils/creator-program-queries.util';
import { buildExpandedBrandQueries } from './utils/brand-query-expansion.util';
import {
  buildSerpLenses,
  buildSimplifiedSerpQuery,
  mergeHitGeoAttributions,
  parseGeoLensesMode,
  planSerpCalls,
  resolveSerpGeo,
  type BrandDiscoveryGeoLensesMode,
  type HitGeoAttribution,
  type SerpCallOmission,
  type SerpLens,
  type UnresolvedSerpRegion,
} from './utils/resolve-serp-geo.util';

export const BRAND_DISCOVERY_PLAN_TIMEOUT_MS = 120_000;
export const BRAND_DISCOVERY_SCORE_TIMEOUT_MS = 300_000;
/** Organic results requested per SERP query (more hits → more distinct brand domains). */
export const BRAND_DISCOVERY_SERP_MAX_RESULTS_PER_QUERY = 10;
/** Below this many validated queries, the plan is topped up from the IBP taxonomy. */
export const BRAND_DISCOVERY_MIN_QUERIES_DEFAULT = 6;
/** Cap on queries after top-up. */
export const BRAND_DISCOVERY_MAX_QUERIES_DEFAULT = 8;
/** Max filtered SERP hits sent to SCORE (bounds local-LLM scoring time). */
export const BRAND_DISCOVERY_MAX_SCORE_HITS_DEFAULT = 30;
/**
 * Hits per SCORE_CANDIDATES call. A local CPU model answers a non-streaming
 * request only when the whole completion is done, so one 30-hit prompt could
 * exceed every timeout and lose the run; batches finish sooner and a failed
 * batch no longer fails the run. Each batch re-reads the full instructions, so
 * 15 (two batches for 30 hits) halves that fixed cost vs 10; it fits the 8192
 * context the worker sets via OLLAMA_NUM_CTX.
 */
export const BRAND_DISCOVERY_SCORE_BATCH_SIZE_DEFAULT = 15;
/** Pause before a simplified SERP retry and between legacy-mode queries (empty_body bans). */
export const BRAND_DISCOVERY_SERP_INTER_QUERY_DELAY_MS = 3_000;
/** Concurrent SERP calls per run (replaces sequential calls + fixed pause). */
export const BRAND_DISCOVERY_SERP_CONCURRENCY_DEFAULT = 4;
export const BRAND_DISCOVERY_MAX_SERP_CALLS_DEFAULT = 12;

export type BrandDiscoveryAiSeedBrand = {
  name: string;
  website: string;
  sector?: string;
  market?: string;
  brandSize?: string;
  evidenceUrls?: string[];
};

export type BrandDiscoveryAiOrchestrateParams = {
  runId: string;
  userId: string;
  influencerId: string;
  influencerName: string;
  niche?: string | null;
  subNiche?: string | null;
  /** Multi-value niches (Talent Manager) — preferred over legacy niche alone. */
  niches?: string[] | null;
  /** Primary / first residence country (prompts + query expansion). */
  country?: string | null;
  /** All residence countries — each becomes a SERP local_home lens. */
  countries?: string[] | null;
  language?: string | null;
  followers?: number | null;
  engagement?: number | null;
  ibp: IbpCriteriaSnapshot;
  limit: number;
  seedBrands?: BrandDiscoveryAiSeedBrand[];
  /** When omitted, loads Settings via AiPromptsService. */
  promptInstructions?: string;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

export type BrandDiscoveryAiOrchestrationResult = {
  queries: string[];
  searchHits: WebSearchHit[];
  searchHitsCount: number;
  brands: ScoredBrand[];
  planExecutionId: string | null;
  scoreExecutionId: string | null;
  strategy: 'llm' | 'templates';
  plannedQueriesCount: number;
  validatedQueriesCount: number;
  fallbackUsed: boolean;
  /** Nest PLAN query validation (diversity / sector-generic / mode quota). */
  planQueryValidation?: BrandSearchQueryValidationDiagnostics;
  /** True when at least one planned query used a short SERP retry. */
  serpQueryFallbackUsed: boolean;
  /** AI-004.5.1.1 — per SERP query; no HTML bodies. */
  serpDiagnostics: BrandDiscoverySerpQueryDiagnostic[];
  /** Soft hit filter before SCORE (noise / dedupe observability). */
  serpHitFilter: SerpHitFilterDiagnostics;
  /** P1b geographic mode (legacy default). */
  geoLensesMode: BrandDiscoveryGeoLensesMode;
  serpLenses?: SerpLens[];
  unresolvedSerpRegions?: UnresolvedSerpRegion[];
  serpCallsPlanned?: number;
  serpCallsExecuted?: number;
  serpCallsOmitted?: number;
  serpCallsMax?: number;
  hitGeoAttribution?: HitGeoAttribution[];
  /** SCORE_CANDIDATES batching: how many calls ran and how many failed. */
  scoreBatches?: { total: number; failed: number; hitsPerBatch: number };
  /** plan_v3 2A: domains found on creator/ambassador program queries. */
  creatorProgramDomains?: string[];
  creatorProgramQueries?: string[];
};

type ResolvedQueries = {
  queries: string[];
  strategy: 'llm' | 'templates';
  plannedQueriesCount: number;
  fallbackUsed: boolean;
  planExecutionId: string | null;
  planQueryValidation?: BrandSearchQueryValidationDiagnostics;
};

@Injectable()
export class BrandDiscoveryAiOrchestrator {
  private readonly logger = new Logger(BrandDiscoveryAiOrchestrator.name);

  constructor(
    private readonly publisher: AiExecutionPublisherService,
    private readonly resultWait: AiExecutionResultWaitService,
    private readonly webSearch: BrightDataWebSearchProvider,
    private readonly aiPromptsService: AiPromptsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * PLAN_SEARCH (Mastra) → validate queries → Bright Data SERP → SCORE_CANDIDATES (Mastra).
   * Does not apply hard filters or persist — BrandDiscoveryService owns that.
   */
  async orchestrate(
    params: BrandDiscoveryAiOrchestrateParams,
  ): Promise<BrandDiscoveryAiOrchestrationResult> {
    const resolved = await this.resolveQueries(params);
    const geoMode = parseGeoLensesMode(
      this.configService.get<string>('BRAND_DISCOVERY_GEO_LENSES'),
    );
    const maxSerpCalls = this.resolveMaxSerpCalls();

    // Creator-program footprints run alongside the planned queries.
    const [serpPass, program] = await Promise.all([
      geoMode === 'v1'
        ? this.runSerpPassV1(params, resolved.queries, maxSerpCalls)
        : this.runSerpPassLegacy(params, resolved.queries),
      this.runCreatorProgramPass(params),
    ]);

    const { serpHitFilter, serpDiagnostics, serpQueryFallbackUsed } = serpPass;
    const { hits: searchHits, programDomains } = mergeCreatorProgramHits(
      serpPass.searchHits,
      program.hits,
    );

    // AI-004.5: SCORE always runs after a successful SERP pass (including
    // soft zero-hit categories). Hard provider errors throw from webSearch
    // and must not be coerced into an empty-hit SCORE.
    if (searchHits.length === 0) {
      const categories = serpDiagnostics.map((d) => d.resultCategory).join(',');
      this.logger.warn(
        `Brand Discovery SERP returned 0 hits for runId=${params.runId}; categories=[${categories}]; still running SCORE_CANDIDATES with empty searchHits`,
      );
    } else if (serpHitFilter.discardedCount > 0) {
      this.logger.log(
        JSON.stringify({
          event: 'brand_discovery_serp_hit_filter',
          runId: params.runId,
          receivedCount: serpHitFilter.receivedCount,
          keptCount: serpHitFilter.keptCount,
          discardedCount: serpHitFilter.discardedCount,
          noiseHostCount: serpHitFilter.noiseHostCount,
          secondaryContentCount: serpHitFilter.secondaryContentCount,
          duplicateDomainCount: serpHitFilter.duplicateDomainCount,
          invalidUrlCount: serpHitFilter.invalidUrlCount,
          fallbackToRaw: serpHitFilter.fallbackToRaw,
          discardedReasons: serpHitFilter.discarded.map((d) => d.reason),
        }),
      );
    }

    const promptInstructions =
      params.promptInstructions?.trim() ||
      (await this.aiPromptsService.getBrandDiscoveryInstructions());

    const scoreHits = searchHits
      .slice(
        0,
        this.readIntConfig(
          'BRAND_DISCOVERY_MAX_SCORE_HITS',
          BRAND_DISCOVERY_MAX_SCORE_HITS_DEFAULT,
          1,
          100,
        ),
      )
      .map((hit) => ({
        title: hit.title,
        url: hit.url,
        content: hit.content,
      }));

    const {
      brands,
      scoreExecutionId,
      batches: scoreBatches,
    } = await this.scoreInBatches(params, scoreHits, promptInstructions);

    return {
      queries: resolved.queries,
      searchHits,
      searchHitsCount: searchHits.length,
      brands,
      planExecutionId: resolved.planExecutionId,
      scoreExecutionId,
      scoreBatches,
      ...(program.queries.length > 0
        ? {
            creatorProgramQueries: program.queries,
            creatorProgramDomains: programDomains,
          }
        : {}),
      strategy: resolved.strategy,
      plannedQueriesCount: resolved.plannedQueriesCount,
      validatedQueriesCount: resolved.queries.length,
      fallbackUsed: resolved.fallbackUsed,
      ...(resolved.planQueryValidation
        ? { planQueryValidation: resolved.planQueryValidation }
        : {}),
      serpQueryFallbackUsed,
      serpDiagnostics,
      serpHitFilter,
      geoLensesMode: geoMode,
      ...(serpPass.serpLenses ? { serpLenses: serpPass.serpLenses } : {}),
      ...(serpPass.unresolvedSerpRegions
        ? { unresolvedSerpRegions: serpPass.unresolvedSerpRegions }
        : {}),
      ...(serpPass.serpCallsPlanned != null
        ? { serpCallsPlanned: serpPass.serpCallsPlanned }
        : {}),
      ...(serpPass.serpCallsExecuted != null
        ? { serpCallsExecuted: serpPass.serpCallsExecuted }
        : {}),
      ...(serpPass.serpCallsOmitted != null
        ? { serpCallsOmitted: serpPass.serpCallsOmitted }
        : {}),
      ...(serpPass.serpCallsMax != null
        ? { serpCallsMax: serpPass.serpCallsMax }
        : {}),
      ...(serpPass.hitGeoAttribution
        ? { hitGeoAttribution: serpPass.hitGeoAttribution }
        : {}),
    };
  }

  private resolveMaxSerpCalls(): number {
    const raw = this.configService.get<string | number>(
      'BRAND_DISCOVERY_MAX_SERP_CALLS',
    );
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 1) {
      return BRAND_DISCOVERY_MAX_SERP_CALLS_DEFAULT;
    }
    return Math.min(Math.floor(n), 24);
  }

  private async runSerpPassLegacy(
    params: BrandDiscoveryAiOrchestrateParams,
    queries: string[],
  ): Promise<{
    searchHits: WebSearchHit[];
    serpHitFilter: SerpHitFilterDiagnostics;
    serpDiagnostics: BrandDiscoverySerpQueryDiagnostic[];
    serpQueryFallbackUsed: boolean;
    serpLenses?: SerpLens[];
    unresolvedSerpRegions?: UnresolvedSerpRegion[];
    serpCallsPlanned?: number;
    serpCallsExecuted?: number;
    serpCallsOmitted?: number;
    serpCallsMax?: number;
    hitGeoAttribution?: HitGeoAttribution[];
  }> {
    const geo = resolveSerpGeo({
      country: params.country,
      language: params.language,
      markets: params.ibp.markets,
    });

    const serpOutcomes: WebSearchWithDiagnostics[] = [];
    let serpQueryFallbackUsed = false;
    for (let i = 0; i < queries.length; i += 1) {
      if (i > 0) {
        await this.serpPause();
      }
      const outcome = await this.searchQueryWithOptionalSimplify(
        queries[i],
        params,
        geo,
      );
      if (outcome.usedSimplified) {
        serpQueryFallbackUsed = true;
      }
      serpOutcomes.push(outcome.result);
    }
    const rawSearchHits = serpOutcomes.flatMap((o) => o.hits);
    const { hits: searchHits, diagnostics: serpHitFilter } =
      filterBrandDiscoverySearchHitsWithDiagnostics(rawSearchHits);
    const serpDiagnostics = serpOutcomes.map((o) => ({
      ...o.diagnostic,
      gl: geo.gl,
      hl: geo.hl,
    }));

    return {
      searchHits,
      serpHitFilter,
      serpDiagnostics,
      serpQueryFallbackUsed,
      serpCallsPlanned: queries.length,
      serpCallsExecuted: queries.length,
      serpCallsOmitted: 0,
      serpCallsMax: queries.length,
    };
  }

  private async runSerpPassV1(
    params: BrandDiscoveryAiOrchestrateParams,
    queries: string[],
    maxSerpCalls: number,
  ): Promise<{
    searchHits: WebSearchHit[];
    serpHitFilter: SerpHitFilterDiagnostics;
    serpDiagnostics: BrandDiscoverySerpQueryDiagnostic[];
    serpQueryFallbackUsed: boolean;
    serpLenses: SerpLens[];
    unresolvedSerpRegions: UnresolvedSerpRegion[];
    serpCallsPlanned: number;
    serpCallsExecuted: number;
    serpCallsOmitted: number;
    serpCallsMax: number;
    hitGeoAttribution: HitGeoAttribution[];
  }> {
    const { lenses, unresolvedRegions } = buildSerpLenses({
      countries: params.countries,
      country: params.country,
      language: params.language,
      markets: params.ibp.markets,
      regionCountryConfig: {
        LATAM: this.configService.get<string>(
          'BRAND_DISCOVERY_REGION_LATAM_COUNTRIES',
        ),
        Europe: this.configService.get<string>(
          'BRAND_DISCOVERY_REGION_EUROPE_COUNTRIES',
        ),
      },
    });

    const planned = planSerpCalls({
      queries,
      lenses,
      markets: params.ibp.markets,
      country: params.country,
      maxCalls: maxSerpCalls,
    });

    this.logger.log(
      JSON.stringify({
        event: 'brand_discovery_serp_lens_plan',
        runId: params.runId,
        geoLensesMode: 'v1',
        lenses: lenses.map((l) => ({
          role: l.role,
          marketLabel: l.marketLabel,
          gl: l.gl,
          hl: l.hl,
        })),
        unresolvedRegions,
        plannedCount: planned.plannedCount,
        executeCount: planned.executed.length,
        omittedCount: planned.omitted.length,
        maxCalls: maxSerpCalls,
      }),
    );

    const serpDiagnostics: BrandDiscoverySerpQueryDiagnostic[] = [];
    const attributionRows: Array<{
      domain: string;
      marketLabel: string;
      role: SerpLens['role'];
      gl: string;
      hl: string;
    }> = [];
    const rawHits: WebSearchHit[] = [];
    let serpQueryFallbackUsed = false;

    // Bounded parallelism instead of sequential calls + fixed pause; results
    // are consumed in plan order so diagnostics stay aligned with `queries`.
    const outcomes = await mapPool(
      planned.executed,
      this.resolveSerpConcurrency(),
      (item) =>
        this.searchQueryWithOptionalSimplify(item.query, params, {
          gl: item.lens.gl,
          hl: item.lens.hl,
        }),
    );

    for (const [i, item] of planned.executed.entries()) {
      const outcome = outcomes[i];
      if (outcome.usedSimplified) {
        serpQueryFallbackUsed = true;
      }
      serpDiagnostics.push({
        ...outcome.result.diagnostic,
        gl: item.lens.gl,
        hl: item.lens.hl,
        marketLabel: item.lens.marketLabel,
        lensRole: item.lens.role,
        queryTargetMarket: item.queryTargetMarket,
      });
      for (const hit of outcome.result.hits) {
        rawHits.push(hit);
        const domain = normalizeDomain(hit.url);
        if (domain) {
          attributionRows.push({
            domain,
            marketLabel: item.lens.marketLabel,
            role: item.lens.role,
            gl: item.lens.gl,
            hl: item.lens.hl,
          });
        }
      }
    }

    for (const omission of planned.omitted) {
      serpDiagnostics.push(this.omissionToDiagnostic(omission));
    }

    const { hits: searchHits, diagnostics: serpHitFilter } =
      filterBrandDiscoverySearchHitsWithDiagnostics(rawHits);
    const keptDomains = new Set(serpHitFilter.keptDomains);
    const hitGeoAttribution = mergeHitGeoAttributions(
      attributionRows.filter((r) => keptDomains.has(r.domain)),
    );

    return {
      searchHits,
      serpHitFilter,
      serpDiagnostics,
      serpQueryFallbackUsed,
      serpLenses: lenses,
      unresolvedSerpRegions: unresolvedRegions,
      serpCallsPlanned: planned.plannedCount,
      serpCallsExecuted: planned.executed.length,
      serpCallsOmitted: planned.omitted.length,
      serpCallsMax: maxSerpCalls,
      hitGeoAttribution,
    };
  }

  private omissionToDiagnostic(
    omission: SerpCallOmission,
  ): BrandDiscoverySerpQueryDiagnostic {
    return {
      query: omission.query,
      resultCategory: 'omitted',
      httpStatus: 0,
      responseBytes: 0,
      latencyMs: 0,
      attempts: 0,
      organicResultsCount: 0,
      gl: omission.lens.gl,
      hl: omission.lens.hl,
      marketLabel: omission.lens.marketLabel,
      lensRole: omission.lens.role,
      queryTargetMarket: omission.queryTargetMarket,
      omitReason: omission.reason,
    };
  }

  /**
   * plan_v3 Paso 2A — BRAND_DISCOVERY_PROGRAM_QUERIES (default 2, 0 disables)
   * calls on the primary geo. Soft: any failure yields no program hits.
   */
  private async runCreatorProgramPass(
    params: BrandDiscoveryAiOrchestrateParams,
  ): Promise<{ hits: WebSearchHit[]; queries: string[] }> {
    const max = this.readIntConfig('BRAND_DISCOVERY_PROGRAM_QUERIES', 2, 0, 4);
    const queries = buildCreatorProgramQueries(
      [
        ...(params.ibp.targetSectors ?? []),
        ...(params.niches ?? []),
        params.niche,
      ],
      max,
    );
    if (queries.length === 0) return { hits: [], queries };
    const geo = resolveSerpGeo({
      country: params.country,
      language: params.language,
      markets: params.ibp.markets,
    });
    try {
      const outcomes = await mapPool(queries, queries.length, (query) =>
        this.safeSerpSearch(query, geo),
      );
      const raw = outcomes.flatMap((o) => o.hits);
      const { hits } = filterBrandDiscoverySearchHitsWithDiagnostics(raw);
      this.logger.log(
        JSON.stringify({
          event: 'brand_discovery_creator_program_pass',
          runId: params.runId,
          queries,
          rawHits: raw.length,
          keptHits: hits.length,
        }),
      );
      return { hits, queries };
    } catch (error) {
      this.logger.warn(
        `Creator program pass failed for runId=${params.runId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { hits: [], queries };
    }
  }

  private async searchQueryWithOptionalSimplify(
    query: string,
    params: BrandDiscoveryAiOrchestrateParams,
    geo: { gl: string; hl: string },
  ): Promise<{ result: WebSearchWithDiagnostics; usedSimplified: boolean }> {
    const primary = await this.safeSerpSearch(query, geo);
    if (primary.hits.length > 0) {
      return { result: primary, usedSimplified: false };
    }

    const simplified = buildSimplifiedSerpQuery({
      niche: params.niche,
      subNiche: params.subNiche,
      country: params.country,
      markets: params.ibp.markets,
    });
    if (!simplified || simplified === query) {
      return { result: primary, usedSimplified: false };
    }

    this.logger.warn(
      `Brand Discovery SERP empty for query="${query}"; retrying simplified="${simplified}"`,
    );
    await this.serpPause();
    const secondary = await this.safeSerpSearch(simplified, geo);
    if (secondary.hits.length > 0) {
      return { result: secondary, usedSimplified: true };
    }
    return {
      result: {
        hits: [],
        diagnostic: {
          ...primary.diagnostic,
          query: `${query} → ${simplified}`,
        },
      },
      usedSimplified: true,
    };
  }

  /**
   * Softens empty_body / network_error into zero hits so SCORE can finish;
   * other SERP failures still throw.
   */
  private async safeSerpSearch(
    query: string,
    geo: { gl: string; hl: string },
  ): Promise<WebSearchWithDiagnostics> {
    try {
      return await this.webSearch.searchWithDiagnostics(query, {
        maxResults: BRAND_DISCOVERY_SERP_MAX_RESULTS_PER_QUERY,
        geo,
      });
    } catch (error) {
      if (
        error instanceof BrightDataSerpProviderError &&
        (error.details.resultCategory === 'empty_body' ||
          error.details.resultCategory === 'network_error')
      ) {
        this.logger.warn(
          `Brand Discovery SERP recoverable failure (${error.details.resultCategory}) for query="${query}"`,
        );
        return {
          hits: [],
          diagnostic: {
            query,
            resultCategory: error.details.resultCategory,
            httpStatus: error.details.httpStatus,
            responseBytes: 0,
            latencyMs: 0,
            attempts: 1,
            organicResultsCount: 0,
            ...(error.details.zone ? { zone: error.details.zone } : {}),
            ...(error.details.parseError
              ? { parseError: error.details.parseError }
              : {}),
          },
        };
      }
      throw error;
    }
  }

  /**
   * PLAN_SEARCH (or templates) followed by a deterministic top-up: validation
   * routinely discards most LLM queries, which left a single SERP call and no
   * brands. Topping up from the IBP's concrete subcategories keeps the query
   * set diverse without depending on the planner model.
   */
  private async resolveQueries(
    params: BrandDiscoveryAiOrchestrateParams,
  ): Promise<ResolvedQueries> {
    const base = await this.resolveQueriesBase(params);
    return this.topUpQueries(params, base);
  }

  private topUpQueries(
    params: BrandDiscoveryAiOrchestrateParams,
    base: ResolvedQueries,
  ): ResolvedQueries {
    const minQueries = this.readIntConfig(
      'BRAND_DISCOVERY_MIN_QUERIES',
      BRAND_DISCOVERY_MIN_QUERIES_DEFAULT,
      0,
      12,
    );
    if (base.queries.length >= minQueries) {
      return base;
    }
    const maxTotal = this.readIntConfig(
      'BRAND_DISCOVERY_MAX_QUERIES',
      BRAND_DISCOVERY_MAX_QUERIES_DEFAULT,
      1,
      12,
    );

    const expanded = buildExpandedBrandQueries({
      sectors: params.ibp.targetSectors ?? [],
      niches: params.niches,
      niche: params.niche,
      markets: params.ibp.markets,
      country: params.country,
      max: maxTotal,
    });
    if (expanded.length === 0) {
      return base;
    }

    const merged = validateBrandSearchQueriesWithDiagnostics(
      [...base.queries, ...expanded],
      {
        maxQueries: maxTotal,
        excludedSectors: params.ibp.excludedSectors,
        targetSectors: params.ibp.targetSectors,
        // Expanded queries deliberately mix homepage / creator-program shapes.
        maxCollaborationModeQueries: 4,
      },
    );
    if (merged.queries.length <= base.queries.length) {
      return base;
    }

    this.logger.log(
      JSON.stringify({
        event: 'brand_discovery_query_topup',
        runId: params.runId,
        before: base.queries.length,
        after: merged.queries.length,
        added: merged.queries.filter((q) => !base.queries.includes(q)),
      }),
    );

    const previous = base.planQueryValidation;
    return {
      ...base,
      queries: merged.queries,
      fallbackUsed: true,
      planQueryValidation: {
        receivedCount: (previous?.receivedCount ?? 0) + expanded.length,
        keptCount: merged.queries.length,
        discardedCount:
          (previous?.discardedCount ?? 0) + merged.diagnostics.discardedCount,
        discarded: [
          ...(previous?.discarded ?? []),
          ...merged.diagnostics.discarded,
        ],
        keptCategorySignatures: merged.diagnostics.keptCategorySignatures,
      },
    };
  }

  private readIntConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = this.configService.get<string | number>(key);
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) {
      return fallback;
    }
    return Math.min(Math.max(Math.floor(n), min), max);
  }

  private async resolveQueriesBase(
    params: BrandDiscoveryAiOrchestrateParams,
  ): Promise<ResolvedQueries> {
    const mode =
      this.configService.get<string>('BRAND_SEARCH_STRATEGY') === 'templates'
        ? 'templates'
        : 'llm';

    if (mode === 'templates') {
      const raw = this.templateQueries(params);
      const validated = validateBrandSearchQueriesWithDiagnostics(raw, {
        maxQueries: BRAND_SEARCH_MAX_QUERIES,
        excludedSectors: params.ibp.excludedSectors,
        targetSectors: params.ibp.targetSectors,
      });
      return {
        queries: validated.queries,
        strategy: 'templates',
        plannedQueriesCount: raw.length,
        fallbackUsed: false,
        planExecutionId: null,
        planQueryValidation: validated.diagnostics,
      };
    }

    const promptInstructions =
      params.promptInstructions?.trim() ||
      (await this.aiPromptsService.getBrandDiscoveryInstructions());

    // CPU-only hosts need more than the 120 s default (BRAND_DISCOVERY_PLAN_TIMEOUT_MS).
    const planTimeoutMs = this.readIntConfig(
      'BRAND_DISCOVERY_PLAN_TIMEOUT_MS',
      BRAND_DISCOVERY_PLAN_TIMEOUT_MS,
      30_000,
      1_800_000,
    );
    const { executionId: planExecutionId } =
      await this.publisher.publishBrandDiscoveryPlan({
        timeoutMs: planTimeoutMs,
        runId: params.runId,
        userId: params.userId,
        influencerId: params.influencerId,
        ...this.influencerPublishFields(params),
        ibp: params.ibp,
        maxQueries: BRAND_SEARCH_MAX_QUERIES,
        promptInstructions,
        actorRole: params.actorRole,
        locale: params.locale,
      });

    try {
      const result = await this.resultWait.waitForAiExecutionResult(
        planExecutionId,
        planTimeoutMs,
      );

      if (result.status === 'FAILED') {
        const workerCode = result.error?.code;
        if (workerCode === 'AI_INVALID_OUTPUT') {
          this.logger.warn(
            `PLAN_SEARCH AI_INVALID_OUTPUT executionId=${planExecutionId}; using template queries`,
          );
          const templateRaw = this.templateQueries(params);
          const templateValidated = validateBrandSearchQueriesWithDiagnostics(
            templateRaw,
            {
              maxQueries: BRAND_SEARCH_MAX_QUERIES,
              excludedSectors: params.ibp.excludedSectors,
              targetSectors: params.ibp.targetSectors,
            },
          );
          return {
            queries: templateValidated.queries,
            strategy: 'llm',
            plannedQueriesCount: 0,
            fallbackUsed: true,
            planExecutionId,
            planQueryValidation: templateValidated.diagnostics,
          };
        }

        throw new BrandDiscoveryAiOrchestratorError(
          workerCode ?? BRAND_DISCOVERY_AI_ERROR_CODES.PLAN_FAILED,
          result.error?.message ??
            `PLAN_SEARCH failed for executionId=${planExecutionId}`,
          { executionId: planExecutionId },
        );
      }

      if (result.status !== 'COMPLETED') {
        throw new BrandDiscoveryAiOrchestratorError(
          BRAND_DISCOVERY_AI_ERROR_CODES.PLAN_FAILED,
          `PLAN_SEARCH unexpected status=${result.status} executionId=${planExecutionId}`,
          { executionId: planExecutionId },
        );
      }

      if (
        result.type !== 'BRAND_DISCOVERY' ||
        !result.output ||
        result.output.operation !== 'PLAN_SEARCH'
      ) {
        throw new BrandDiscoveryAiOrchestratorError(
          BRAND_DISCOVERY_AI_ERROR_CODES.PLAN_INVALID_OPERATION,
          `Expected BRAND_DISCOVERY PLAN_SEARCH output for executionId=${planExecutionId}`,
          { executionId: planExecutionId },
        );
      }

      const plannedQueriesCount = result.output.queries.length;
      const validated = validateBrandSearchQueriesWithDiagnostics(
        result.output.queries,
        {
          maxQueries: BRAND_SEARCH_MAX_QUERIES,
          excludedSectors: params.ibp.excludedSectors,
          targetSectors: params.ibp.targetSectors,
        },
      );

      if (validated.diagnostics.discardedCount > 0) {
        this.logger.log(
          JSON.stringify({
            event: 'brand_discovery_plan_query_validation',
            runId: params.runId,
            executionId: planExecutionId,
            receivedCount: validated.diagnostics.receivedCount,
            keptCount: validated.diagnostics.keptCount,
            discarded: validated.diagnostics.discarded,
            keptCategorySignatures:
              validated.diagnostics.keptCategorySignatures,
          }),
        );
      }

      if (validated.queries.length === 0) {
        const templateRaw = this.templateQueries(params);
        const templateValidated = validateBrandSearchQueriesWithDiagnostics(
          templateRaw,
          {
            maxQueries: BRAND_SEARCH_MAX_QUERIES,
            excludedSectors: params.ibp.excludedSectors,
            targetSectors: params.ibp.targetSectors,
          },
        );
        return {
          queries: templateValidated.queries,
          strategy: 'llm',
          plannedQueriesCount,
          fallbackUsed: true,
          planExecutionId,
          planQueryValidation: {
            ...validated.diagnostics,
            // Surface that Nest replaced an empty validated set with templates.
            discarded: [
              ...validated.diagnostics.discarded,
              ...templateValidated.diagnostics.discarded,
            ],
            keptCount: templateValidated.queries.length,
            keptCategorySignatures:
              templateValidated.diagnostics.keptCategorySignatures,
          },
        };
      }

      return {
        queries: validated.queries,
        strategy: 'llm',
        plannedQueriesCount,
        fallbackUsed: false,
        planExecutionId,
        planQueryValidation: validated.diagnostics,
      };
    } catch (error) {
      if (error instanceof BrandDiscoveryAiOrchestratorError) {
        throw error;
      }
      throw this.mapWaitError(error, planExecutionId, 'PLAN_SEARCH');
    }
  }

  /**
   * Scores the hits in small sequential batches. A batch that fails is logged
   * and skipped; the run only fails when every batch fails. Brands are merged
   * by domain, keeping the higher score.
   */
  private async scoreInBatches(
    params: BrandDiscoveryAiOrchestrateParams,
    scoreHits: Array<{ title: string; url: string; content: string }>,
    promptInstructions: string,
  ): Promise<{
    brands: ScoredBrand[];
    scoreExecutionId: string | null;
    batches: { total: number; failed: number; hitsPerBatch: number };
  }> {
    const hitsPerBatch = this.readIntConfig(
      'BRAND_DISCOVERY_SCORE_BATCH_SIZE',
      BRAND_DISCOVERY_SCORE_BATCH_SIZE_DEFAULT,
      1,
      100,
    );
    // SCORE must still run once with zero hits (soft-empty SERP, AI-004.5).
    const chunks: Array<typeof scoreHits> = [];
    for (let i = 0; i < scoreHits.length; i += hitsPerBatch) {
      chunks.push(scoreHits.slice(i, i + hitsPerBatch));
    }
    if (chunks.length === 0) chunks.push([]);

    const timeoutMs = this.readIntConfig(
      'BRAND_DISCOVERY_SCORE_TIMEOUT_MS',
      BRAND_DISCOVERY_SCORE_TIMEOUT_MS,
      30_000,
      1_800_000,
    );
    const byDomain = new Map<string, ScoredBrand>();
    let firstExecutionId: string | null = null;
    let failed = 0;
    let lastError: unknown;

    for (const [index, chunk] of chunks.entries()) {
      try {
        const { executionId } = await this.publisher.publishBrandDiscoveryScore({
          timeoutMs,
          runId: params.runId,
          userId: params.userId,
          influencerId: params.influencerId,
          ...this.influencerPublishFields(params),
          ibp: params.ibp,
          limit: params.limit,
          searchHits: chunk,
          // Seeds once (first batch): later batches would just re-score them.
          seedBrands: index === 0 ? params.seedBrands : undefined,
          promptInstructions,
          actorRole: params.actorRole,
          locale: params.locale,
        });
        firstExecutionId ??= executionId;
        const brands = await this.waitForScoreBrands(executionId, timeoutMs);
        for (const brand of brands) {
          const key = normalizeDomain(brand.website) || brand.website;
          const previous = byDomain.get(key);
          if (!previous || (brand.score ?? 0) > (previous.score ?? 0)) {
            byDomain.set(key, brand);
          }
        }
      } catch (error) {
        failed += 1;
        lastError = error;
        this.logger.warn(
          JSON.stringify({
            event: 'brand_discovery_score_batch_failed',
            runId: params.runId,
            batch: index + 1,
            of: chunks.length,
            hits: chunk.length,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    if (failed === chunks.length) {
      throw lastError;
    }
    if (failed > 0) {
      this.logger.warn(
        JSON.stringify({
          event: 'brand_discovery_score_partial',
          runId: params.runId,
          failedBatches: failed,
          totalBatches: chunks.length,
        }),
      );
    }

    return {
      brands: [...byDomain.values()],
      scoreExecutionId: firstExecutionId,
      batches: { total: chunks.length, failed, hitsPerBatch },
    };
  }

  private async waitForScoreBrands(
    scoreExecutionId: string,
    timeoutMs: number,
  ): Promise<ScoredBrand[]> {
    try {
      const result = await this.resultWait.waitForAiExecutionResult(
        scoreExecutionId,
        timeoutMs,
      );

      if (result.status === 'FAILED') {
        throw new BrandDiscoveryAiOrchestratorError(
          result.error?.code ?? BRAND_DISCOVERY_AI_ERROR_CODES.SCORE_FAILED,
          result.error?.message ??
            `SCORE_CANDIDATES failed for executionId=${scoreExecutionId}`,
          { executionId: scoreExecutionId },
        );
      }

      if (result.status !== 'COMPLETED') {
        throw new BrandDiscoveryAiOrchestratorError(
          BRAND_DISCOVERY_AI_ERROR_CODES.SCORE_FAILED,
          `SCORE_CANDIDATES unexpected status=${result.status} executionId=${scoreExecutionId}`,
          { executionId: scoreExecutionId },
        );
      }

      if (
        result.type !== 'BRAND_DISCOVERY' ||
        !result.output ||
        result.output.operation !== 'SCORE_CANDIDATES'
      ) {
        throw new BrandDiscoveryAiOrchestratorError(
          BRAND_DISCOVERY_AI_ERROR_CODES.SCORE_INVALID_OPERATION,
          `Expected BRAND_DISCOVERY SCORE_CANDIDATES output for executionId=${scoreExecutionId}`,
          { executionId: scoreExecutionId },
        );
      }

      return result.output.brands;
    } catch (error) {
      if (error instanceof BrandDiscoveryAiOrchestratorError) {
        throw error;
      }
      throw this.mapWaitError(error, scoreExecutionId, 'SCORE_CANDIDATES');
    }
  }

  private templateQueries(params: BrandDiscoveryAiOrchestrateParams): string[] {
    return buildBrandDiscoveryQueries(
      params.ibp,
      params.influencerName,
      params.niche,
      { country: params.country, niches: params.niches },
    ).slice(0, BRAND_SEARCH_MAX_QUERIES);
  }

  private influencerPublishFields(params: BrandDiscoveryAiOrchestrateParams) {
    return {
      influencerName: params.influencerName,
      niche: params.niche,
      subNiche: params.subNiche,
      niches: params.niches,
      country: params.country,
      language: params.language,
      followers: params.followers,
      engagement: params.engagement,
    };
  }

  /** Concurrent Bright Data SERP calls per run (1 = previous sequential behaviour). */
  private resolveSerpConcurrency(): number {
    return this.readIntConfig(
      'BRAND_DISCOVERY_SERP_CONCURRENCY',
      BRAND_DISCOVERY_SERP_CONCURRENCY_DEFAULT,
      1,
      8,
    );
  }

  /** Skips real waits in Jest so empty-SERP paths stay fast. */
  private async serpPause(): Promise<void> {
    if (this.configService.get<string>('NODE_ENV') === 'test') {
      return;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, BRAND_DISCOVERY_SERP_INTER_QUERY_DELAY_MS),
    );
  }

  private mapWaitError(
    error: unknown,
    executionId: string,
    phase: 'PLAN_SEARCH' | 'SCORE_CANDIDATES',
  ): BrandDiscoveryAiOrchestratorError {
    if (error instanceof AiExecutionWaitError) {
      return new BrandDiscoveryAiOrchestratorError(
        error.code,
        `${phase} wait failed: ${error.message}`,
        { executionId: error.executionId || executionId, cause: error },
      );
    }

    return new BrandDiscoveryAiOrchestratorError(
      BRAND_DISCOVERY_AI_ERROR_CODES.WAIT,
      `${phase} wait failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { executionId, cause: error },
    );
  }
}
