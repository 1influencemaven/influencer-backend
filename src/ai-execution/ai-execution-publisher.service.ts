import { createHash, randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_CONTRACT_VERSION,
  type AiExecutionRequest,
  type AiLlmConfiguration,
  type BrandDiscoveryInput,
  type IbpCriteriaSnapshot,
} from '@influence-maven/ai-contracts';
import { Queue } from 'bullmq';

import { AI_EXECUTION_JOBS, AI_EXECUTION_QUEUES } from './ai-execution.queues';
import { mapInfluencerToIbpInput } from './map-influencer-to-ibp-input';

type InfluencerLike = Parameters<typeof mapInfluencerToIbpInput>[0];

/** Agreed Brand Discovery plan cap (ADR-0015 / BRAND_SEARCH_MAX_QUERIES). */
export const BRAND_DISCOVERY_DEFAULT_MAX_QUERIES = 4;

export type PublishIbpExecutionParams = {
  influencer: InfluencerLike;
  userId: string;
  promptInstructions: string;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

type BrandDiscoveryPublishContext = {
  runId: string;
  userId: string;
  influencerId: string;
  influencerName: string;
  niche?: string | null;
  ibp: IbpCriteriaSnapshot;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

export type PublishBrandDiscoveryPlanParams = BrandDiscoveryPublishContext & {
  /** Defaults to {@link BRAND_DISCOVERY_DEFAULT_MAX_QUERIES}. */
  maxQueries?: number;
};

type ScoreSearchHit = Extract<
  BrandDiscoveryInput,
  { operation: 'SCORE_CANDIDATES' }
>['searchHits'][number];

type ScoreSeedBrand = NonNullable<
  Extract<BrandDiscoveryInput, { operation: 'SCORE_CANDIDATES' }>['seedBrands']
>[number];

export type PublishBrandDiscoveryScoreParams = BrandDiscoveryPublishContext & {
  limit: number;
  searchHits: ScoreSearchHit[];
  seedBrands?: ScoreSeedBrand[];
  /** Settings business instructions for scoring. */
  promptInstructions: string;
};

export type PublishContactResearchFindEmailsParams = {
  runId: string;
  userId: string;
  influencerId: string;
  brandName: string;
  website: string;
  domain: string;
  niche?: string | null;
  maxSerpQueries?: number;
  maxPages?: number;
  /** Optional business instructions; FIND_BRAND_EMAILS uses fixed 2A prompt in worker. */
  promptInstructions?: string;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

export type PublishAiExecutionIds = {
  executionId: string;
  correlationId: string;
};

@Injectable()
export class AiExecutionPublisherService {
  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(AI_EXECUTION_QUEUES.REQUESTS)
    private readonly requestsQueue: Queue,
  ) {}

  async publishIbpGeneration(
    params: PublishIbpExecutionParams,
  ): Promise<PublishAiExecutionIds> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = params.promptInstructions;
    const businessHash = this.hashBusinessInstructions(business);

    const request: AiExecutionRequest = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `ibp:${params.influencer.id}:${executionId}`,
      requestedAt: new Date().toISOString(),
      type: 'IBP_GENERATION',
      context: {
        userId: params.userId,
        influencerId: params.influencer.id,
        resourceId: params.influencer.id,
        resourceType: 'IDEAL_BRAND_PROFILE',
        locale: params.locale,
        actorRole: params.actorRole,
      },
      instructions: { business, businessHash },
      configuration: this.resolveLlmConfiguration(),
      input: mapInfluencerToIbpInput(params.influencer),
    };

    await this.enqueueRequest(request, executionId);
    return { executionId, correlationId };
  }

  /**
   * Publishes BRAND_DISCOVERY / PLAN_SEARCH.
   * `instructions.business` is empty (plan does not use Settings scoring prompt).
   */
  async publishBrandDiscoveryPlan(
    params: PublishBrandDiscoveryPlanParams,
  ): Promise<PublishAiExecutionIds> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = '';
    const businessHash = this.hashBusinessInstructions(business);
    const maxQueries = params.maxQueries ?? BRAND_DISCOVERY_DEFAULT_MAX_QUERIES;

    const request: AiExecutionRequest = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `brand-plan:${params.runId}:${executionId}`,
      requestedAt: new Date().toISOString(),
      type: 'BRAND_DISCOVERY',
      context: {
        userId: params.userId,
        influencerId: params.influencerId,
        resourceId: params.runId,
        resourceType: 'BRAND_DISCOVERY_RUN',
        locale: params.locale,
        actorRole: params.actorRole,
      },
      instructions: { business, businessHash },
      configuration: this.resolveLlmConfiguration(),
      input: {
        operation: 'PLAN_SEARCH',
        influencerName: params.influencerName,
        niche: params.niche,
        ibp: params.ibp,
        maxQueries,
      },
    };

    await this.enqueueRequest(request, executionId);
    return { executionId, correlationId };
  }

  /**
   * Publishes BRAND_DISCOVERY / SCORE_CANDIDATES with Settings instructions.
   */
  async publishBrandDiscoveryScore(
    params: PublishBrandDiscoveryScoreParams,
  ): Promise<PublishAiExecutionIds> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = params.promptInstructions;
    const businessHash = this.hashBusinessInstructions(business);

    const request: AiExecutionRequest = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `brand-score:${params.runId}:${executionId}`,
      requestedAt: new Date().toISOString(),
      type: 'BRAND_DISCOVERY',
      context: {
        userId: params.userId,
        influencerId: params.influencerId,
        resourceId: params.runId,
        resourceType: 'BRAND_DISCOVERY_RUN',
        locale: params.locale,
        actorRole: params.actorRole,
      },
      instructions: { business, businessHash },
      configuration: this.resolveLlmConfiguration(),
      input: {
        operation: 'SCORE_CANDIDATES',
        influencerName: params.influencerName,
        niche: params.niche,
        ibp: params.ibp,
        limit: params.limit,
        searchHits: params.searchHits,
        ...(params.seedBrands !== undefined
          ? { seedBrands: params.seedBrands }
          : {}),
      },
    };

    await this.enqueueRequest(request, executionId);
    return { executionId, correlationId };
  }

  /**
   * Publishes CONTACT_RESEARCH / FIND_BRAND_EMAILS (Paso 3 — Mastra + Bright Data tools).
   */
  async publishContactResearchFindBrandEmails(
    params: PublishContactResearchFindEmailsParams,
  ): Promise<PublishAiExecutionIds> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = params.promptInstructions?.trim() ?? '';
    const businessHash = this.hashBusinessInstructions(business);
    const maxSerpQueries = params.maxSerpQueries ?? 5;
    const maxPages = params.maxPages ?? 5;

    const request: AiExecutionRequest = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `contact-emails:${params.runId}:${executionId}`,
      requestedAt: new Date().toISOString(),
      type: 'CONTACT_RESEARCH',
      context: {
        userId: params.userId,
        influencerId: params.influencerId,
        resourceId: params.runId,
        resourceType: 'CONTACT_RESEARCH_RUN',
        locale: params.locale,
        actorRole: params.actorRole,
      },
      instructions: { business, businessHash },
      configuration: this.resolveLlmConfiguration(),
      input: {
        operation: 'FIND_BRAND_EMAILS',
        brandName: params.brandName,
        website: params.website,
        domain: params.domain,
        maxSerpQueries,
        maxPages,
        ...(params.niche?.trim() ? { niche: params.niche.trim() } : {}),
      },
    };

    await this.enqueueRequest(request, executionId);
    return { executionId, correlationId };
  }

  /** sha256 hex truncated to 16 chars — same convention as IBP. */
  private hashBusinessInstructions(business: string): string {
    return createHash('sha256').update(business).digest('hex').slice(0, 16);
  }

  private resolveLlmConfiguration(): AiLlmConfiguration | undefined {
    const provider =
      this.configService.get<string>('AI_PROVIDER') ??
      (this.configService.get<string>('NODE_ENV') === 'production'
        ? 'anthropic'
        : 'ollama');

    const model =
      provider === 'anthropic'
        ? (this.configService.get<string>('ANTHROPIC_MODEL') ??
          'claude-sonnet-4-20250514')
        : (this.configService.get<string>('OLLAMA_MODEL') ?? 'llama3.2:3b');

    if (provider === 'ollama' || provider === 'anthropic') {
      return { provider, model };
    }
    return undefined;
  }

  private async enqueueRequest(
    request: AiExecutionRequest,
    executionId: string,
  ): Promise<void> {
    await this.requestsQueue.add(AI_EXECUTION_JOBS.EXECUTE, request, {
      jobId: executionId,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
}
