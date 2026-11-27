import { createHash, randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_CONTRACT_VERSION,
  type AiExecutionRequest,
  type AiLlmConfiguration,
  type BrandDiscoveryInput,
  type ContactResearchPageSnapshot,
  type IbpCriteriaSnapshot,
} from '@influence-maven/ai-contracts';
import { Queue } from 'bullmq';

import { sanitizeContactResearchSeedUrls } from '../lead-discovery/utils/contact-research-seed-urls.util';
import { AI_EXECUTION_JOBS, AI_EXECUTION_QUEUES } from './ai-execution.queues';
import { mapInfluencerToIbpInput } from './map-influencer-to-ibp-input';

type InfluencerLike = Parameters<typeof mapInfluencerToIbpInput>[0];

/** Agreed Brand Discovery plan cap (ADR-0015 amend / BRAND_SEARCH_MAX_QUERIES). */
export const BRAND_DISCOVERY_DEFAULT_MAX_QUERIES = 4;

export type PublishIbpExecutionParams = {
  influencer: InfluencerLike;
  userId: string;
  promptInstructions: string;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

type BrandDiscoveryPublishContext = {
  /** Nest wait budget; the worker aborts the LLM call once it elapses. */
  timeoutMs?: number;
  runId: string;
  userId: string;
  influencerId: string;
  influencerName: string;
  niche?: string | null;
  subNiche?: string | null;
  niches?: string[] | null;
  country?: string | null;
  language?: string | null;
  followers?: number | null;
  engagement?: number | null;
  ibp: IbpCriteriaSnapshot;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

export type PublishBrandDiscoveryPlanParams = BrandDiscoveryPublishContext & {
  /** Defaults to {@link BRAND_DISCOVERY_DEFAULT_MAX_QUERIES}. */
  maxQueries?: number;
  /** Settings Brand Discovery prompt — guides query generation. */
  promptInstructions: string;
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

type ResearchPageSnapshot = Extract<
  BrandDiscoveryInput,
  { operation: 'RESEARCH_BRAND' }
>['pageSnapshots'][number];

export type PublishBrandDiscoveryResearchParams =
  BrandDiscoveryPublishContext & {
    brand: { name: string; website: string; domain: string };
    pageSnapshots: ResearchPageSnapshot[];
    maxPages?: number;
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
  /** RF-02: Brand Discovery evidenceUrls (on-domain preferred seed). */
  seedUrls?: string[];
  /** Optional Settings Lead Discovery business instructions; worker defaults when empty and keeps hard rules immutable. */
  promptInstructions?: string;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

export type PublishContactResearchFindPeopleParams = {
  runId: string;
  userId: string;
  influencerId: string;
  brandName: string;
  website: string;
  domain: string;
  niche?: string | null;
  priorityRoles?: string[];
  maxSerpQueries?: number;
  maxProfilesToScrape?: number;
  maxBrandPages?: number;
  ocrEnabled?: boolean;
  /**
   * RF-04.3: same-run FIND_BRAND_EMAILS page snapshots for PEE reuse.
   * In-memory Nest bridge only — never Redis/persisted store.
   */
  pageSnapshots?: ContactResearchPageSnapshot[];
  promptInstructions?: string;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

/** 2C.4.5 — Agency mailbox research (CONTACT_RESEARCH / FIND_AGENCY_EMAILS). */
export type PublishContactResearchFindAgencyEmailsParams = {
  runId: string;
  userId: string;
  influencerId: string;
  agencyId: string;
  agencyName: string;
  website: string;
  domain: string;
  niche?: string | null;
  niches?: string[];
  country?: string | null;
  markets?: string[];
  maxSerpQueries?: number;
  maxPages?: number;
  /** On-domain preferred seeds (InfluencerAgency.evidenceUrls). */
  seedUrls?: string[];
  promptInstructions?: string;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

/** 2C.4.6 — Agency people research (CONTACT_RESEARCH / FIND_AGENCY_PEOPLE). */
export type PublishContactResearchFindAgencyPeopleParams = {
  runId: string;
  userId: string;
  influencerId: string;
  agencyId: string;
  agencyName: string;
  website: string;
  domain: string;
  niche?: string | null;
  niches?: string[];
  country?: string | null;
  markets?: string[];
  priorityRoles?: string[];
  maxSerpQueries?: number;
  maxProfilesToScrape?: number;
  maxAgencyPages?: number;
  ocrEnabled?: boolean;
  /** Same-run FIND_AGENCY_EMAILS snapshots (Nest memory bridge). */
  pageSnapshots?: ContactResearchPageSnapshot[];
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
   * Publishes BRAND_DISCOVERY / PLAN_SEARCH with Settings instructions +
   * influencer form profile (country, followers, etc.).
   */
  async publishBrandDiscoveryPlan(
    params: PublishBrandDiscoveryPlanParams,
  ): Promise<PublishAiExecutionIds> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = params.promptInstructions;
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
      ...this.timeoutLimits(params.timeoutMs),
      input: {
        operation: 'PLAN_SEARCH',
        ...this.brandDiscoveryInfluencerInput(params),
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
      ...this.timeoutLimits(params.timeoutMs),
      input: {
        operation: 'SCORE_CANDIDATES',
        ...this.brandDiscoveryInfluencerInput(params),
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
   * Publishes BRAND_DISCOVERY / RESEARCH_BRAND with Nest-prepared page snapshots.
   */
  async publishBrandDiscoveryResearch(
    params: PublishBrandDiscoveryResearchParams,
  ): Promise<PublishAiExecutionIds> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = params.promptInstructions;
    const businessHash = this.hashBusinessInstructions(business);
    const maxPages = Math.min(params.maxPages ?? 4, 4);

    const request: AiExecutionRequest = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `brand-research:${params.runId}:${params.brand.domain}:${executionId}`,
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
      limits: {
        maxPages,
        ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      },
      input: {
        operation: 'RESEARCH_BRAND',
        ...this.brandDiscoveryInfluencerInput(params),
        ibp: params.ibp,
        brand: params.brand,
        pageSnapshots: params.pageSnapshots.slice(0, maxPages),
        maxPages,
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
        ...(() => {
          const seedUrls = sanitizeContactResearchSeedUrls(params.seedUrls, 12);
          return seedUrls.length ? { seedUrls } : {};
        })(),
      },
    };

    await this.enqueueRequest(request, executionId);
    return { executionId, correlationId };
  }

  /**
   * Publishes CONTACT_RESEARCH / FIND_BRAND_PEOPLE (Track 2B — LinkedIn + PEE).
   */
  async publishContactResearchFindBrandPeople(
    params: PublishContactResearchFindPeopleParams,
  ): Promise<PublishAiExecutionIds> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = params.promptInstructions?.trim() ?? '';
    const businessHash = this.hashBusinessInstructions(business);

    const request: AiExecutionRequest = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `contact-people:${params.runId}:${executionId}`,
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
        operation: 'FIND_BRAND_PEOPLE',
        brandName: params.brandName,
        website: params.website,
        domain: params.domain,
        maxSerpQueries: params.maxSerpQueries ?? 4,
        maxProfilesToScrape: params.maxProfilesToScrape ?? 5,
        maxBrandPages: params.maxBrandPages ?? 6,
        ocrEnabled: params.ocrEnabled ?? false,
        ...(params.niche?.trim() ? { niche: params.niche.trim() } : {}),
        ...(params.priorityRoles?.length
          ? { priorityRoles: params.priorityRoles }
          : {}),
        ...(params.pageSnapshots?.length
          ? { pageSnapshots: params.pageSnapshots.slice(0, 4) }
          : {}),
      },
    };

    await this.enqueueRequest(request, executionId);
    return { executionId, correlationId };
  }

  /**
   * Publishes CONTACT_RESEARCH / FIND_AGENCY_EMAILS (2C.4.5 — agency mailboxes).
   * Same envelope as brand contact research; subject is Agency identity.
   */
  async publishContactResearchFindAgencyEmails(
    params: PublishContactResearchFindAgencyEmailsParams,
  ): Promise<PublishAiExecutionIds> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = params.promptInstructions?.trim() ?? '';
    const businessHash = this.hashBusinessInstructions(business);
    const maxSerpQueries = params.maxSerpQueries ?? 5;
    const maxPages = params.maxPages ?? 5;
    const niches = (params.niches ?? [])
      .map((n) => n?.trim())
      .filter((n): n is string => Boolean(n));
    const markets = (params.markets ?? [])
      .map((m) => m?.trim())
      .filter((m): m is string => Boolean(m));

    const request: AiExecutionRequest = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `agency-emails:${params.runId}:${params.agencyId}:${executionId}`,
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
        operation: 'FIND_AGENCY_EMAILS',
        agencyId: params.agencyId,
        agencyName: params.agencyName,
        website: params.website,
        domain: params.domain,
        maxSerpQueries,
        maxPages,
        ...(params.niche?.trim() ? { niche: params.niche.trim() } : {}),
        ...(niches.length ? { niches } : {}),
        ...(params.country?.trim() ? { country: params.country.trim() } : {}),
        ...(markets.length ? { markets } : {}),
        ...(() => {
          const seedUrls = sanitizeContactResearchSeedUrls(params.seedUrls, 12);
          return seedUrls.length ? { seedUrls } : {};
        })(),
      },
    };

    await this.enqueueRequest(request, executionId);
    return { executionId, correlationId };
  }

  /**
   * Publishes CONTACT_RESEARCH / FIND_AGENCY_PEOPLE (2C.4.6 — people-pass ALWAYS).
   */
  async publishContactResearchFindAgencyPeople(
    params: PublishContactResearchFindAgencyPeopleParams,
  ): Promise<PublishAiExecutionIds> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = params.promptInstructions?.trim() ?? '';
    const businessHash = this.hashBusinessInstructions(business);
    const niches = (params.niches ?? [])
      .map((n) => n?.trim())
      .filter((n): n is string => Boolean(n));
    const markets = (params.markets ?? [])
      .map((m) => m?.trim())
      .filter((m): m is string => Boolean(m));

    const request: AiExecutionRequest = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `agency-people:${params.runId}:${params.agencyId}:${executionId}`,
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
        operation: 'FIND_AGENCY_PEOPLE',
        agencyId: params.agencyId,
        agencyName: params.agencyName,
        website: params.website,
        domain: params.domain,
        peoplePassPolicy: 'ALWAYS',
        maxSerpQueries: params.maxSerpQueries ?? 4,
        maxProfilesToScrape: params.maxProfilesToScrape ?? 5,
        maxAgencyPages: params.maxAgencyPages ?? 6,
        ocrEnabled: params.ocrEnabled ?? false,
        ...(params.niche?.trim() ? { niche: params.niche.trim() } : {}),
        ...(niches.length ? { niches } : {}),
        ...(params.country?.trim() ? { country: params.country.trim() } : {}),
        ...(markets.length ? { markets } : {}),
        ...(params.priorityRoles?.length
          ? { priorityRoles: params.priorityRoles }
          : {}),
        ...(params.pageSnapshots?.length
          ? { pageSnapshots: params.pageSnapshots.slice(0, 4) }
          : {}),
      },
    };

    await this.enqueueRequest(request, executionId);
    return { executionId, correlationId };
  }

  private timeoutLimits(
    timeoutMs: number | undefined,
  ): { limits?: { timeoutMs: number } } {
    return timeoutMs ? { limits: { timeoutMs } } : {};
  }

  private brandDiscoveryInfluencerInput(params: BrandDiscoveryPublishContext): {
    influencerName: string;
    niche?: string | null;
    subNiche?: string | null;
    niches?: string[];
    country?: string | null;
    language?: string | null;
    followers?: number | null;
    engagement?: number | null;
  } {
    const niches = (params.niches ?? [])
      .map((n) => n?.trim())
      .filter((n): n is string => Boolean(n));
    return {
      influencerName: params.influencerName,
      niche: params.niche,
      subNiche: params.subNiche,
      ...(niches.length > 0 ? { niches } : {}),
      country: params.country,
      language: params.language,
      followers: params.followers,
      engagement: params.engagement,
    };
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
