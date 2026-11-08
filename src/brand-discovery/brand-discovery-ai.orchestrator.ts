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
import { BrightDataWebSearchProvider } from './providers/brightdata-web-search.provider';
import {
  BRAND_DISCOVERY_AI_ERROR_CODES,
  BrandDiscoveryAiOrchestratorError,
} from './brand-discovery-ai.orchestrator.errors';
import {
  BRAND_SEARCH_MAX_QUERIES,
  validateBrandSearchQueries,
} from './utils/brand-search-queries.util';

export const BRAND_DISCOVERY_PLAN_TIMEOUT_MS = 120_000;
export const BRAND_DISCOVERY_SCORE_TIMEOUT_MS = 180_000;
export const BRAND_DISCOVERY_SERP_MAX_RESULTS_PER_QUERY = 6;

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
  /** AI-004.5.1.1 — per SERP query; no HTML bodies. */
  serpDiagnostics: BrandDiscoverySerpQueryDiagnostic[];
};

type ResolvedQueries = {
  queries: string[];
  strategy: 'llm' | 'templates';
  plannedQueriesCount: number;
  fallbackUsed: boolean;
  planExecutionId: string | null;
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

    const serpOutcomes = await Promise.all(
      resolved.queries.map((query) =>
        this.webSearch.searchWithDiagnostics(query, {
          maxResults: BRAND_DISCOVERY_SERP_MAX_RESULTS_PER_QUERY,
        }),
      ),
    );
    const searchHits = serpOutcomes.flatMap((o) => o.hits);
    const serpDiagnostics = serpOutcomes.map((o) => o.diagnostic);

    // AI-004.5: SCORE always runs after a successful SERP pass (including
    // soft zero-hit categories). Hard provider errors throw from webSearch
    // and must not be coerced into an empty-hit SCORE.
    if (searchHits.length === 0) {
      const categories = serpDiagnostics.map((d) => d.resultCategory).join(',');
      this.logger.warn(
        `Brand Discovery SERP returned 0 hits for runId=${params.runId}; categories=[${categories}]; still running SCORE_CANDIDATES with empty searchHits`,
      );
    }

    const promptInstructions =
      params.promptInstructions?.trim() ||
      (await this.aiPromptsService.getBrandDiscoveryInstructions());

    const { executionId: scoreExecutionId } =
      await this.publisher.publishBrandDiscoveryScore({
        runId: params.runId,
        userId: params.userId,
        influencerId: params.influencerId,
        influencerName: params.influencerName,
        niche: params.niche,
        ibp: params.ibp,
        limit: params.limit,
        searchHits: searchHits.map((hit) => ({
          title: hit.title,
          url: hit.url,
          content: hit.content,
        })),
        seedBrands: params.seedBrands,
        promptInstructions,
        actorRole: params.actorRole,
        locale: params.locale,
      });

    const brands = await this.waitForScoreBrands(scoreExecutionId);

    return {
      queries: resolved.queries,
      searchHits,
      searchHitsCount: searchHits.length,
      brands,
      planExecutionId: resolved.planExecutionId,
      scoreExecutionId,
      strategy: resolved.strategy,
      plannedQueriesCount: resolved.plannedQueriesCount,
      validatedQueriesCount: resolved.queries.length,
      fallbackUsed: resolved.fallbackUsed,
      serpDiagnostics,
    };
  }

  private async resolveQueries(
    params: BrandDiscoveryAiOrchestrateParams,
  ): Promise<ResolvedQueries> {
    const mode =
      this.configService.get<string>('BRAND_SEARCH_STRATEGY') === 'templates'
        ? 'templates'
        : 'llm';

    if (mode === 'templates') {
      const queries = this.templateQueries(params);
      return {
        queries,
        strategy: 'templates',
        plannedQueriesCount: queries.length,
        fallbackUsed: false,
        planExecutionId: null,
      };
    }

    const { executionId: planExecutionId } =
      await this.publisher.publishBrandDiscoveryPlan({
        runId: params.runId,
        userId: params.userId,
        influencerId: params.influencerId,
        influencerName: params.influencerName,
        niche: params.niche,
        ibp: params.ibp,
        maxQueries: BRAND_SEARCH_MAX_QUERIES,
        actorRole: params.actorRole,
        locale: params.locale,
      });

    try {
      const result = await this.resultWait.waitForAiExecutionResult(
        planExecutionId,
        BRAND_DISCOVERY_PLAN_TIMEOUT_MS,
      );

      if (result.status === 'FAILED') {
        const workerCode = result.error?.code;
        if (workerCode === 'AI_INVALID_OUTPUT') {
          this.logger.warn(
            `PLAN_SEARCH AI_INVALID_OUTPUT executionId=${planExecutionId}; using template queries`,
          );
          const queries = this.templateQueries(params);
          return {
            queries,
            strategy: 'llm',
            plannedQueriesCount: 0,
            fallbackUsed: true,
            planExecutionId,
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
      const validated = validateBrandSearchQueries(result.output.queries, {
        maxQueries: BRAND_SEARCH_MAX_QUERIES,
        excludedSectors: params.ibp.excludedSectors,
      });

      if (validated.length === 0) {
        const queries = this.templateQueries(params);
        return {
          queries,
          strategy: 'llm',
          plannedQueriesCount,
          fallbackUsed: true,
          planExecutionId,
        };
      }

      return {
        queries: validated,
        strategy: 'llm',
        plannedQueriesCount,
        fallbackUsed: false,
        planExecutionId,
      };
    } catch (error) {
      if (error instanceof BrandDiscoveryAiOrchestratorError) {
        throw error;
      }
      throw this.mapWaitError(error, planExecutionId, 'PLAN_SEARCH');
    }
  }

  private async waitForScoreBrands(
    scoreExecutionId: string,
  ): Promise<ScoredBrand[]> {
    try {
      const result = await this.resultWait.waitForAiExecutionResult(
        scoreExecutionId,
        BRAND_DISCOVERY_SCORE_TIMEOUT_MS,
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
    ).slice(0, BRAND_SEARCH_MAX_QUERIES);
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
