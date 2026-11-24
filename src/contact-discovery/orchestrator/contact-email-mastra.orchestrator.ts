import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AgencyDiscoveryOutput,
  AgencySearchMetadata,
  ContactResearchPageSnapshot,
} from '@influence-maven/ai-contracts';
import type { Prisma } from '../../generated/prisma/client';
import { DbNull } from '../../generated/prisma/internal/prismaNamespace';
import {
  ContactChannelSource,
  ContactChannelType,
  LeadDiscoveryStatus,
} from '../../generated/prisma/enums';

import {
  AgencyContactEmailsResearchService,
  type Track2CEmailsPassMetadata,
} from '../../agency-discovery/agency-contact-emails-research.service';
import {
  AgencyContactPeopleResearchService,
  type Track2CPeoplePassMetadata,
} from '../../agency-discovery/agency-contact-people-research.service';
import { AgencyDiscoveryService } from '../../agency-discovery/agency-discovery.service';
import { AiExecutionPublisherService } from '../../ai-execution/ai-execution-publisher.service';
import { AiExecutionWaitError } from '../../ai-execution/ai-execution-result-wait.errors';
import { AiExecutionResultWaitService } from '../../ai-execution/ai-execution-result-wait.service';
import {
  ContactChannelService,
  type CreateChannelInput,
} from '../../lead-discovery/contact-channel.service';
import { BrandBusinessContactService } from '../../lead-discovery/brand-business-contact.service';
import {
  classifyCommercialRelevance,
  commercialCoverageTier,
} from '../../lead-discovery/utils/commercial-relevance.util';
import { classifyPublicEmailGeneric } from '../../lead-discovery/utils/public-email-generic.util';
import { buildCorroboratedBrandDomains } from '../../lead-discovery/utils/brand-business-contact-domain.util';
import { canAttributeEmailToPerson } from '../../lead-discovery/utils/contact-email-attribution.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  emptySaleshandyTrace,
  SaleshandyEnrichmentService,
  type SaleshandyTrace,
} from '../saleshandy/saleshandy-enrichment.service';
import {
  MASTRA_CONTACT_EMAILS_PROVIDER_ID,
  MASTRA_FIND_BRAND_PEOPLE_PROVIDER_ID,
} from '../constants';
import type { BbcDiscoveryResult } from './bbc-discovery.types';
import type { BbcRunOutcome, BbcSearchMetadataV2 } from './bbc-search-metadata';
import {
  decideTrack2BExecution,
  type Track2BDecision,
} from './track-2b-decision.util';
import {
  buildContactResearchTimings,
  defaultOrchestratorClock,
  readAiDurationMs,
  type ContactResearchTimings,
  type OrchestratorClock,
} from './contact-research-timings';

/** 2A tool-loop can take several minutes. */
export const CONTACT_EMAIL_MASTRA_TIMEOUT_MS = 300_000;
/** 2B SERP + LinkedIn scrapes + PEE. */
export const CONTACT_PEOPLE_MASTRA_TIMEOUT_MS = 300_000;

export type ContactEmailMastraInput = {
  runId: string;
  brandCandidateId: string;
  influencerId: string;
  website: string;
  domain: string;
  brandName?: string;
  niche?: string | null;
  maxPages?: number;
  userId?: string;
  /** RF-02: Brand Discovery evidenceUrls for preferred seed. */
  seedUrls?: string[];
};

/** RF-02 / RF-02.1 coverage metrics (additive on searchMetadata). */
export type ContactResearchCoverage2A = {
  brandsInvestigated: 1;
  emailsExtracted: number;
  emailsPersistedCreated: number;
  emailsPersistedUpdated: number;
  emailsSkippedDomain: number;
  urlsFromTrace: number;
  hasHigh: boolean;
  hasMedium: boolean;
  hasGeneral: boolean;
  hasOnlyGeneral: boolean;
  hasNone: boolean;
};

/** RF-03 observability: why 2B ran or was skipped (additive on searchMetadata). */
export type Track2BDecisionMetadata = {
  executed: boolean;
  reason: Track2BDecision['reason'];
  hasHigh: boolean;
  hasMedium: boolean;
};

/** 2C.3 / 2C.4.5: Agency Discovery + optional FIND_AGENCY_EMAILS pass. */
export type Track2CResultMetadata = {
  executed: boolean;
  outcome?: AgencyDiscoveryOutput['outcome'];
  error?: string | null;
  candidatesCount?: number;
  persistedCount?: number;
  searchMetadata?: AgencySearchMetadata;
  /** 2C.4.5: mailbox research over eligible InfluencerAgency rows. */
  emailsPass?: Track2CEmailsPassMetadata;
  /** 2C.4.6: people-pass ALWAYS over eligible InfluencerAgency rows. */
  peoplePass?: Track2CPeoplePassMetadata;
};

type MastraSearchMetadata = BbcSearchMetadataV2 & {
  engine: 'mastra';
  tracks: Array<'2A' | '2B' | '2C'>;
  operation2A?: 'FIND_BRAND_EMAILS';
  operation2B?: 'FIND_BRAND_PEOPLE';
  operation2C?: 'DISCOVER_AGENCIES';
  executionId2A?: string;
  executionId2B?: string;
  aiOutcome2A?: string;
  aiOutcome2B?: string;
  summary2A?: string | null;
  summary2B?: string | null;
  peopleSearchTrace?: Prisma.InputJsonValue | null;
  personLeadsCreated?: number;
  personLeadsUpdated?: number;
  track2BError?: string | null;
  coverage2A?: ContactResearchCoverage2A;
  /** RF-03: conditional 2B decision after this-run 2A coverage. */
  track2BDecision?: Track2BDecisionMetadata;
  /** Enrichment waterfall level 1/2: Saleshandy Lead Finder + reveal (additive). */
  saleshandy?: SaleshandyTrace;
  /** RF-04.1: Nest wait + Mastra durationMs (additive; omitted on historical runs). */
  timings?: ContactResearchTimings;
  /** RF-04.2: page origin counters from Mastra 2A trace (additive). */
  pageOriginCounts?: {
    seedPagesAttempted: number;
    seedPagesDownloaded: number;
    serpSeedPagesAttempted: number;
    serpSeedPagesDownloaded: number;
    llmPagesAttempted: number;
    llmPagesDownloaded: number;
    llmPagesReused: number;
    duplicateUrlSkips: number;
  };
  /** 2C.3: Agency Discovery (always attempted when influencer context exists). */
  track2C?: Track2CResultMetadata;
};

type Track2CPhaseResult = {
  executed: boolean;
  outcome?: AgencyDiscoveryOutput['outcome'];
  error?: string | null;
  candidatesCount: number;
  persistedCount: number;
  searchMetadata?: AgencySearchMetadata;
  summary?: string | null;
  emailsPass?: Track2CEmailsPassMetadata;
  peoplePass?: Track2CPeoplePassMetadata;
};

/**
 * Publish FIND_BRAND_EMAILS (2A) then conditional FIND_BRAND_PEOPLE (2B),
 * plus always-on Agency Discovery (2C) + agency emails/people research.
 */
@Injectable()
export class ContactEmailMastraOrchestrator {
  private readonly logger = new Logger(ContactEmailMastraOrchestrator.name);
  /**
   * RF-04.1 clock seam (defaults to performance.now).
   * Tests may replace for deterministic wait/total measurements.
   */
  clock: OrchestratorClock = defaultOrchestratorClock;

  constructor(
    private readonly publisher: AiExecutionPublisherService,
    private readonly resultWait: AiExecutionResultWaitService,
    private readonly brandBusinessContacts: BrandBusinessContactService,
    private readonly contactChannels: ContactChannelService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly agencyDiscovery: AgencyDiscoveryService,
    private readonly agencyContactEmails: AgencyContactEmailsResearchService,
    private readonly agencyContactPeople: AgencyContactPeopleResearchService,
    @Optional()
    private readonly saleshandy?: SaleshandyEnrichmentService,
  ) {}

  async execute(input: ContactEmailMastraInput): Promise<BbcDiscoveryResult> {
    const orchestratorStartedMs = this.clock.now();
    const maxSerpQueries =
      this.configService.get<number>('AI_RESEARCH_MAX_SERP_QUERIES') ?? 5;
    const maxPages =
      input.maxPages ??
      this.configService.get<number>('AI_RESEARCH_MAX_PAGES') ??
      5;
    const maxPeopleSerp =
      this.configService.get<number>('AI_PEOPLE_MAX_SERP_QUERIES') ?? 4;
    const maxProfiles =
      this.configService.get<number>('AI_PEOPLE_MAX_PROFILES') ?? 3;
    const maxBrandPages =
      this.configService.get<number>('AI_PEOPLE_MAX_BRAND_PAGES') ?? 6;
    const ocrEnabled =
      this.configService.get<boolean>('CONTACT_OCR_ENABLED') === true;

    const domain =
      input.domain
        .trim()
        .toLowerCase()
        .replace(/^www\./, '') || this.domainFromWebsite(input.website);
    const brandName = input.brandName?.trim() || domain;
    const userId = input.userId ?? 'system:contact-email-mastra';

    // 2C.3: always attempt Agency Discovery once (soft-isolated). It does not
    // depend on 2A, so it starts first and overlaps 2A + 2B instead of waiting
    // for 2A. Hard-fail 2A still awaits it before a single failRun.
    const phase2CPromise = this.runTrack2C({
      influencerId: input.influencerId,
      nicheFallback: input.niche,
      runId: input.runId,
      userId,
    });

    // Enrichment level 1 (Saleshandy, verified nominal emails): independent of
    // 2A, so it overlaps it. Soft-fail: the service never throws.
    const saleshandyCtx = {
      brandCandidateId: input.brandCandidateId,
      influencerId: input.influencerId,
      runId: input.runId,
      domain,
    };
    const saleshandyPromise: Promise<SaleshandyTrace> = this.saleshandy
      ? this.saleshandy.enrichByDomain(saleshandyCtx)
      : Promise.resolve(emptySaleshandyTrace(false));

    // --- Track 2A ---
    const phase2A = await this.runTrack2A({
      input,
      brandName,
      domain,
      userId,
      maxSerpQueries,
      maxPages,
    });
    const contactsPersisted = phase2A.contactsCreated + phase2A.contactsUpdated;

    // Case F: hard 2A → skip RF-03 entirely (do not invent track2BDecision),
    // await 2C, then persist FAILED once with final metadata.
    if (phase2A.hardFailed) {
      await saleshandyPromise;
      const phase2C = await phase2CPromise;
      const track2CMeta = this.toTrack2CMetadata(phase2C);
      const tracksOnFail: Array<'2A' | '2C'> = phase2C.executed
        ? ['2A', '2C']
        : ['2A'];
      const hard = phase2A.hardFail;
      return this.failRun(
        input.runId,
        hard?.errorMessage ?? 'Track 2A failed',
        {
          executionId: hard?.executionId ?? phase2A.executionId,
          errorCode: hard?.errorCode,
          contactsCreated: hard?.contactsCreated ?? phase2A.contactsCreated,
          contactsUpdated: hard?.contactsUpdated ?? phase2A.contactsUpdated,
          partialContactsMayExist:
            hard?.partialContactsMayExist === true ||
            phase2A.contactsCreated + phase2A.contactsUpdated > 0,
          searchMetadata: {
            schemaVersion: 2,
            engine: 'mastra',
            tracks: tracksOnFail,
            operation2A: 'FIND_BRAND_EMAILS',
            ...(phase2C.executed
              ? { operation2C: 'DISCOVER_AGENCIES' as const }
              : {}),
            executionId2A: hard?.executionId ?? phase2A.executionId,
            // Intentionally omit track2BDecision: RF-03 never ran (2A hard-fail).
            track2C: track2CMeta,
            timings: buildContactResearchTimings({
              wait2AMs: phase2A.waitMs,
              aiDuration2AMs: phase2A.aiDurationMs,
              totalOrchestratorMs: this.clock.now() - orchestratorStartedMs,
            }),
            ...(phase2A.pageOriginCounts
              ? { pageOriginCounts: phase2A.pageOriginCounts }
              : {}),
          },
        },
      );
    }

    // RF-03 v2: 2B unless a verified nominal email (Tier 1) already exists.
    let saleshandyTrace = await saleshandyPromise;
    const track2BDecision = decideTrack2BExecution({
      hasHigh: phase2A.tierFlags.hasHigh,
      hasMedium: phase2A.tierFlags.hasMedium,
      emailsPersistedThisRun: contactsPersisted,
      hasTier1Nominal: this.saleshandy?.hasTier1(saleshandyTrace) === true,
    });

    let peopleCreated = 0;
    let peopleUpdated = 0;
    let executionId2B: string | undefined;
    let aiOutcome2B: string | undefined;
    let summary2B: string | null = null;
    let peopleTrace: Prisma.InputJsonValue | null = null;
    let track2BError: string | null = null;
    let wait2BMs: number | undefined;
    let aiDuration2BMs: number | null | undefined;

    // RF-04.3: hold 2A snapshots in-memory for this execute() only (no Redis).
    const pageSnapshotsFrom2A = phase2A.pageSnapshots;

    if (track2BDecision.shouldRun) {
      try {
        const phase2B = await this.runTrack2B({
          input,
          brandName,
          domain,
          userId,
          maxPeopleSerp,
          maxProfiles,
          maxBrandPages,
          ocrEnabled,
          ...(pageSnapshotsFrom2A?.length
            ? { pageSnapshots: pageSnapshotsFrom2A }
            : {}),
        });
        peopleCreated = phase2B.leadsCreated;
        peopleUpdated = phase2B.leadsUpdated;
        executionId2B = phase2B.executionId;
        aiOutcome2B = phase2B.aiOutcome;
        summary2B = phase2B.summary;
        peopleTrace = phase2B.trace;
        track2BError = phase2B.error;
        // RF-04.1.1: only copy wait metrics when Nest actually started waiting.
        if (typeof phase2B.waitMs === 'number') {
          wait2BMs = phase2B.waitMs;
          aiDuration2BMs = phase2B.aiDurationMs;
        }
      } catch (error) {
        // Case G: soft-fail 2B — keep 2A persistence.
        // Wait may never have started; omit wait2BMs (do not invent 0).
        track2BError =
          error instanceof Error ? error.message.slice(0, 2000) : String(error);
        this.logger.warn(
          JSON.stringify({
            event: 'contact_people_mastra_unexpected_error',
            runId: input.runId,
            errorMessage: track2BError,
          }),
        );
      }
    } else {
      this.logger.log(
        JSON.stringify({
          event: 'contact_people_mastra_skipped',
          runId: input.runId,
          reason: track2BDecision.reason,
          hasHigh: track2BDecision.hasHigh,
          hasMedium: track2BDecision.hasMedium,
        }),
      );
    }

    // Enrichment level 2: LinkedIn people from 2B without email → Saleshandy.
    if (this.saleshandy && track2BDecision.shouldRun && peopleCreated + peopleUpdated > 0) {
      saleshandyTrace = await this.saleshandy.enrichLinkedInLeads(
        saleshandyCtx,
        saleshandyTrace,
      );
    }
    peopleCreated += saleshandyTrace.leadsCreated;
    peopleUpdated += saleshandyTrace.leadsUpdated;

    const phase2C = await phase2CPromise;

    const peoplePersisted = peopleCreated + peopleUpdated;
    const tracks: Array<'2A' | '2B' | '2C'> = ['2A'];
    if (track2BDecision.shouldRun) tracks.push('2B');
    if (phase2C.executed) tracks.push('2C');

    let outcome: BbcRunOutcome;
    if (contactsPersisted > 0 || peoplePersisted > 0) {
      outcome = 'RESULTS_FOUND';
    } else if (
      this.allExecutedTracksFailed({
        aiOutcome2A: phase2A.aiOutcome,
        track2BShouldRun: track2BDecision.shouldRun,
        aiOutcome2B,
        track2BError,
        phase2C,
      })
    ) {
      outcome = 'PROVIDER_FAILURE';
    } else if (
      phase2A.aiOutcome === 'PROVIDER_FAILURE' &&
      track2BDecision.shouldRun &&
      (aiOutcome2B === 'PROVIDER_FAILURE' || track2BError)
    ) {
      outcome = 'PROVIDER_FAILURE';
    } else {
      outcome = 'NO_MATCHES';
    }

    const pages = phase2A.pages;
    // RF-02.1: drop emailsDedupedUpdates (was an alias of updates, not real intra-run dedupe).
    const coverage2A: ContactResearchCoverage2A = {
      brandsInvestigated: 1,
      emailsExtracted: phase2A.emailsFound,
      emailsPersistedCreated: phase2A.contactsCreated,
      emailsPersistedUpdated: phase2A.contactsUpdated,
      emailsSkippedDomain: phase2A.emailsSkippedDomain,
      urlsFromTrace: pages.length,
      hasHigh: phase2A.tierFlags.hasHigh,
      hasMedium: phase2A.tierFlags.hasMedium,
      hasGeneral: phase2A.tierFlags.hasGeneral,
      hasOnlyGeneral:
        phase2A.contactsCreated + phase2A.contactsUpdated > 0 &&
        phase2A.tierFlags.hasGeneral &&
        !phase2A.tierFlags.hasHigh &&
        !phase2A.tierFlags.hasMedium,
      hasNone: phase2A.contactsCreated + phase2A.contactsUpdated === 0,
    };

    const track2BDecisionMeta: Track2BDecisionMetadata = {
      executed: track2BDecision.shouldRun,
      reason: track2BDecision.reason,
      hasHigh: track2BDecision.hasHigh,
      hasMedium: track2BDecision.hasMedium,
    };

    const timings = buildContactResearchTimings({
      wait2AMs: phase2A.waitMs,
      aiDuration2AMs: phase2A.aiDurationMs,
      totalOrchestratorMs: this.clock.now() - orchestratorStartedMs,
      // RF-04.1.1: 2B timing fields only when wait ran (not RF-03 skip / publish-before-wait).
      ...(typeof wait2BMs === 'number'
        ? {
            track2BWait: {
              wait2BMs,
              aiDuration2BMs:
                aiDuration2BMs === undefined ? null : aiDuration2BMs,
            },
          }
        : {}),
    });

    const searchMetadata: MastraSearchMetadata = {
      schemaVersion: 2,
      providerId: 'bbc-brightdata',
      outcome,
      businessContacts: {
        created: phase2A.contactsCreated,
        updated: phase2A.contactsUpdated,
        emailsFound: phase2A.emailsFound,
        pagesAttempted: phase2A.pageCalls,
        pagesSucceeded: pages.length,
        pagesFailed: 0,
        failureCountsByCategory: {},
        discardCountsByReason: {
          ...(phase2A.emailsSkippedDomain > 0
            ? { domain_gate: phase2A.emailsSkippedDomain }
            : {}),
        },
        // RF-04.1: no fabricated per-page elapsedMs (Mastra does not transport them yet).
        pageResults: [],
      },
      engine: 'mastra',
      tracks,
      operation2A: 'FIND_BRAND_EMAILS',
      ...(track2BDecision.shouldRun
        ? { operation2B: 'FIND_BRAND_PEOPLE' as const }
        : {}),
      ...(phase2C.executed
        ? { operation2C: 'DISCOVER_AGENCIES' as const }
        : {}),
      executionId2A: phase2A.executionId,
      ...(executionId2B ? { executionId2B } : {}),
      aiOutcome2A: phase2A.aiOutcome,
      ...(track2BDecision.shouldRun ? { aiOutcome2B } : {}),
      coverage2A,
      summary2A: phase2A.summary,
      ...(track2BDecision.shouldRun
        ? { summary2B, peopleSearchTrace: peopleTrace }
        : {}),
      personLeadsCreated: peopleCreated,
      personLeadsUpdated: peopleUpdated,
      ...(track2BError ? { track2BError } : {}),
      track2BDecision: track2BDecisionMeta,
      ...(saleshandyTrace.enabled ? { saleshandy: saleshandyTrace } : {}),
      track2C: this.toTrack2CMetadata(phase2C),
      timings,
      ...(phase2A.pageOriginCounts
        ? { pageOriginCounts: phase2A.pageOriginCounts }
        : {}),
    };

    try {
      await this.prisma.leadDiscoveryRun.update({
        where: { id: input.runId },
        data: {
          status: LeadDiscoveryStatus.COMPLETED,
          errorMessage: null,
          searchMetadata: searchMetadata as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        JSON.stringify({
          event: 'contact_email_mastra_completed_write_failed',
          runId: input.runId,
          errorMessage: message,
        }),
      );
      return {
        outcome,
        runStatus: 'COMPLETED',
        errorMessage: null,
        searchMetadata,
        contactsCreated: phase2A.contactsCreated,
        contactsUpdated: phase2A.contactsUpdated,
        terminalStatusPersisted: false,
        partialContactsMayExist: contactsPersisted + peoplePersisted > 0,
      };
    }

    this.logger.log(
      JSON.stringify({
        event: 'contact_email_mastra_completed',
        runId: input.runId,
        outcome,
        contactsCreated: phase2A.contactsCreated,
        contactsUpdated: phase2A.contactsUpdated,
        personLeadsCreated: peopleCreated,
        personLeadsUpdated: peopleUpdated,
        providerId: MASTRA_CONTACT_EMAILS_PROVIDER_ID,
        tracks,
        track2BDecision: track2BDecisionMeta,
        track2C: searchMetadata.track2C,
        timings,
      }),
    );

    return {
      outcome,
      runStatus: 'COMPLETED',
      errorMessage: null,
      searchMetadata,
      contactsCreated: phase2A.contactsCreated,
      contactsUpdated: phase2A.contactsUpdated,
      terminalStatusPersisted: true,
      partialContactsMayExist: false,
    };
  }

  private async runTrack2A(params: {
    input: ContactEmailMastraInput;
    brandName: string;
    domain: string;
    userId: string;
    maxSerpQueries: number;
    maxPages: number;
  }): Promise<{
    hardFailed: boolean;
    /**
     * 2C.3.1: hard-fail details only — terminal FAILED is persisted once by
     * execute() after Track 2C (no intermediate failRun from runTrack2A).
     */
    hardFail?: {
      errorMessage: string;
      errorCode?: string;
      executionId?: string;
      contactsCreated?: number;
      contactsUpdated?: number;
      partialContactsMayExist?: boolean;
    };
    executionId?: string;
    contactsCreated: number;
    contactsUpdated: number;
    emailsFound: number;
    emailsSkippedDomain: number;
    pages: string[];
    pageCalls: number;
    aiOutcome?: string;
    summary: string | null;
    /** Nest wait for AI result job (RF-04.1). */
    waitMs: number;
    /** AiExecutionResult.durationMs when available (RF-04.1). */
    aiDurationMs: number | null;
    /** RF-04.2: from Mastra trace when present. */
    pageOriginCounts?: MastraSearchMetadata['pageOriginCounts'];
    /** RF-04.3: same-run snapshots for optional 2B PEE reuse. */
    pageSnapshots?: ContactResearchPageSnapshot[];
    tierFlags: {
      hasHigh: boolean;
      hasMedium: boolean;
      hasGeneral: boolean;
    };
  }> {
    const emptyTiers = {
      hasHigh: false,
      hasMedium: false,
      hasGeneral: false,
    };
    const { input, brandName, domain, userId, maxSerpQueries, maxPages } =
      params;

    let executionId: string;
    try {
      const published =
        await this.publisher.publishContactResearchFindBrandEmails({
          runId: input.runId,
          userId,
          influencerId: input.influencerId,
          brandName,
          website: input.website,
          domain,
          niche: input.niche,
          maxSerpQueries,
          maxPages,
          ...(input.seedUrls?.length ? { seedUrls: input.seedUrls } : {}),
        });
      executionId = published.executionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        hardFailed: true,
        hardFail: { errorMessage: `PUBLISH_FAILED: ${message}` },
        contactsCreated: 0,
        contactsUpdated: 0,
        emailsFound: 0,
        emailsSkippedDomain: 0,
        pages: [],
        pageCalls: 0,
        summary: null,
        waitMs: 0,
        aiDurationMs: null,
        tierFlags: emptyTiers,
      };
    }

    this.logger.log(
      JSON.stringify({
        event: 'contact_email_mastra_published',
        runId: input.runId,
        executionId,
      }),
    );

    const failTrack = (
      message: string,
      extra?: { errorCode?: string },
      timing?: { waitMs: number; aiDurationMs: number | null },
    ) => ({
      hardFailed: true as const,
      hardFail: {
        errorMessage: message,
        executionId,
        ...(extra?.errorCode ? { errorCode: extra.errorCode } : {}),
      },
      contactsCreated: 0,
      contactsUpdated: 0,
      emailsFound: 0,
      emailsSkippedDomain: 0,
      pages: [] as string[],
      pageCalls: 0,
      summary: null as string | null,
      waitMs: timing?.waitMs ?? 0,
      aiDurationMs: timing?.aiDurationMs ?? null,
      tierFlags: emptyTiers,
    });

    let aiResult;
    const waitStartedMs = this.clock.now();
    try {
      aiResult = await this.resultWait.waitForAiExecutionResult(
        executionId,
        CONTACT_EMAIL_MASTRA_TIMEOUT_MS,
      );
    } catch (error) {
      const waitMs = this.clock.now() - waitStartedMs;
      if (error instanceof AiExecutionWaitError) {
        return failTrack(`${error.code}: ${error.message}`, undefined, {
          waitMs,
          aiDurationMs: null,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      return failTrack(`WAIT_FAILED: ${message}`, undefined, {
        waitMs,
        aiDurationMs: null,
      });
    }
    const waitMs = this.clock.now() - waitStartedMs;
    const aiDurationMs = readAiDurationMs(aiResult);

    if (aiResult.type !== 'CONTACT_RESEARCH') {
      return failTrack(
        `Unexpected AI result type=${aiResult.type}`,
        undefined,
        { waitMs, aiDurationMs },
      );
    }

    if (aiResult.status !== 'COMPLETED' || !aiResult.output) {
      return failTrack(
        aiResult.error?.message ??
          `AI execution ${aiResult.status} without output`,
        { errorCode: aiResult.error?.code },
        { waitMs, aiDurationMs },
      );
    }

    if (aiResult.output.operation !== 'FIND_BRAND_EMAILS') {
      return failTrack(
        `Unexpected CONTACT_RESEARCH operation=${aiResult.output.operation}`,
        undefined,
        { waitMs, aiDurationMs },
      );
    }

    const output = aiResult.output;
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let emailsSkippedDomain = 0;
    const tierFlags = { ...emptyTiers };
    const corroboratedDomains = buildCorroboratedBrandDomains({
      brandDomain: domain,
      website: input.website,
    });

    try {
      for (const item of output.emails) {
        const upsert = await this.brandBusinessContacts.upsertFromDiscovery({
          brandCandidateId: input.brandCandidateId,
          email: item.email,
          sourceUrl: item.sourceUrl,
          evidenceSnippet: item.evidenceSnippet ?? item.email,
          brandDomain: domain,
          corroboratedDomains,
          commercialRelevance: classifyCommercialRelevance(item.email),
          isGeneric: classifyPublicEmailGeneric(item.email),
        });
        if (upsert.skipped) {
          emailsSkippedDomain += 1;
          continue;
        }
        const tier = commercialCoverageTier(item.email);
        if (tier === 'HIGH') tierFlags.hasHigh = true;
        if (tier === 'MEDIUM') tierFlags.hasMedium = true;
        if (tier === 'GENERAL') tierFlags.hasGeneral = true;
        if (upsert.created) contactsCreated += 1;
        else if (upsert.updated) contactsUpdated += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        hardFailed: true,
        hardFail: {
          errorMessage: `CONTACT_PERSIST_FAILED: ${message}`,
          executionId,
          contactsCreated,
          contactsUpdated,
          partialContactsMayExist: contactsCreated + contactsUpdated > 0,
        },
        contactsCreated,
        contactsUpdated,
        emailsFound: output.emails.length,
        emailsSkippedDomain,
        pages: output.trace?.pages ?? [],
        pageCalls: output.trace?.pageCalls ?? 0,
        summary: output.summary ?? null,
        waitMs,
        aiDurationMs,
        pageOriginCounts: output.trace?.pageOriginCounts,
        tierFlags,
      };
    }

    return {
      hardFailed: false,
      executionId,
      contactsCreated,
      contactsUpdated,
      emailsFound: output.emails.length,
      emailsSkippedDomain,
      pages: output.trace?.pages ?? [],
      pageCalls: output.trace?.pageCalls ?? 0,
      aiOutcome: output.outcome,
      summary: output.summary ?? null,
      waitMs,
      aiDurationMs,
      pageOriginCounts: output.trace?.pageOriginCounts,
      pageSnapshots: output.pageSnapshots,
      tierFlags,
    };
  }

  private async runTrack2B(params: {
    input: ContactEmailMastraInput;
    brandName: string;
    domain: string;
    userId: string;
    maxPeopleSerp: number;
    maxProfiles: number;
    maxBrandPages: number;
    ocrEnabled: boolean;
    /** RF-04.3: optional same-run 2A snapshots (only when RF-03 runs 2B). */
    pageSnapshots?: ContactResearchPageSnapshot[];
  }): Promise<{
    executionId?: string;
    leadsCreated: number;
    leadsUpdated: number;
    aiOutcome?: string;
    summary: string | null;
    trace: Prisma.InputJsonValue | null;
    error: string | null;
    /**
     * Nest wait duration when waitForAiExecutionResult ran.
     * Undefined when publish failed before wait (RF-04.1.1).
     */
    waitMs?: number;
    aiDurationMs: number | null;
  }> {
    const {
      input,
      brandName,
      domain,
      userId,
      maxPeopleSerp,
      maxProfiles,
      maxBrandPages,
      ocrEnabled,
      pageSnapshots,
    } = params;

    let executionId: string;
    try {
      const published =
        await this.publisher.publishContactResearchFindBrandPeople({
          runId: input.runId,
          userId,
          influencerId: input.influencerId,
          brandName,
          website: input.website,
          domain,
          niche: input.niche,
          maxSerpQueries: maxPeopleSerp,
          maxProfilesToScrape: maxProfiles,
          maxBrandPages,
          ocrEnabled,
          ...(pageSnapshots?.length ? { pageSnapshots } : {}),
        });
      executionId = published.executionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        leadsCreated: 0,
        leadsUpdated: 0,
        summary: null,
        trace: null,
        error: `PUBLISH_PEOPLE_FAILED: ${message}`,
        // RF-04.1.1: wait never started — omit waitMs (do not report 0).
        aiDurationMs: null,
      };
    }

    this.logger.log(
      JSON.stringify({
        event: 'contact_people_mastra_published',
        runId: input.runId,
        executionId,
      }),
    );

    let aiResult;
    const waitStartedMs = this.clock.now();
    try {
      aiResult = await this.resultWait.waitForAiExecutionResult(
        executionId,
        CONTACT_PEOPLE_MASTRA_TIMEOUT_MS,
      );
    } catch (error) {
      const waitMs = this.clock.now() - waitStartedMs;
      const message =
        error instanceof AiExecutionWaitError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      return {
        executionId,
        leadsCreated: 0,
        leadsUpdated: 0,
        summary: null,
        trace: null,
        error: `WAIT_PEOPLE_FAILED: ${message}`,
        waitMs,
        aiDurationMs: null,
      };
    }
    const waitMs = this.clock.now() - waitStartedMs;
    const aiDurationMs = readAiDurationMs(aiResult);

    if (
      aiResult.type !== 'CONTACT_RESEARCH' ||
      aiResult.status !== 'COMPLETED' ||
      !aiResult.output ||
      aiResult.output.operation !== 'FIND_BRAND_PEOPLE'
    ) {
      return {
        executionId,
        leadsCreated: 0,
        leadsUpdated: 0,
        summary: null,
        trace: null,
        error:
          aiResult.error?.message ??
          `Unexpected people result type/status/operation`,
        waitMs,
        aiDurationMs,
      };
    }

    const output = aiResult.output;
    let leadsCreated = 0;
    let leadsUpdated = 0;

    try {
      for (const person of output.people) {
        const result = await this.persistPersonLead({
          input,
          person,
        });
        if (result.created) leadsCreated += 1;
        else leadsUpdated += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        executionId,
        leadsCreated,
        leadsUpdated,
        aiOutcome: output.outcome,
        summary: output.summary ?? null,
        trace: (output.trace ?? null) as Prisma.InputJsonValue | null,
        error: `LEAD_PERSIST_FAILED: ${message}`,
        waitMs,
        aiDurationMs,
      };
    }

    return {
      executionId,
      leadsCreated,
      leadsUpdated,
      aiOutcome: output.outcome,
      summary: output.summary ?? null,
      trace: (output.trace ?? null) as Prisma.InputJsonValue | null,
      error: null,
      waitMs,
      aiDurationMs,
    };
  }

  private async persistPersonLead(params: {
    input: ContactEmailMastraInput;
    person: {
      name: string;
      title?: string;
      linkedinUrl: string;
      emails: Array<{
        email: string;
        sourceUrl: string;
        sourceKind: 'linkedin' | 'brand_web' | 'ocr';
        evidenceSnippet?: string;
      }>;
    };
  }): Promise<{ created: boolean }> {
    const { input, person } = params;
    const profileUrl = person.linkedinUrl.trim();
    const domain =
      input.domain
        .trim()
        .toLowerCase()
        .replace(/^www\./, '') || this.domainFromWebsite(input.website);
    const corroboratedDomains = buildCorroboratedBrandDomains({
      brandDomain: domain,
      website: input.website,
    });

    // RF-01: only keep person↔email links with explicit evidence.
    const attributedEmails = person.emails.filter((email) =>
      canAttributeEmailToPerson({
        email: email.email,
        personName: person.name,
        sourceKind: email.sourceKind,
        evidenceSnippet: email.evidenceSnippet,
      }),
    );

    // Corporate inboxes rejected for person attribution → BBC when domain allows.
    for (const email of person.emails) {
      if (attributedEmails.includes(email)) continue;
      if (!classifyPublicEmailGeneric(email.email)) continue;
      await this.brandBusinessContacts.upsertFromDiscovery({
        brandCandidateId: input.brandCandidateId,
        email: email.email,
        sourceUrl: email.sourceUrl,
        evidenceSnippet: email.evidenceSnippet ?? email.email,
        brandDomain: domain,
        corroboratedDomains,
        commercialRelevance: classifyCommercialRelevance(email.email),
        isGeneric: true,
      });
    }

    const existing = await this.prisma.lead.findFirst({
      where: {
        brandCandidateId: input.brandCandidateId,
        profileUrl,
      },
      select: { id: true },
    });

    const primaryEmail = attributedEmails[0]?.email ?? null;

    const leadId = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.lead.update({
          where: { id: existing.id },
          data: {
            contactName: person.name,
            title: person.title ?? null,
            email: primaryEmail,
            isGeneric: primaryEmail
              ? classifyPublicEmailGeneric(primaryEmail)
              : false,
            runId: input.runId,
            metadata: {
              track: '2B',
              sourceKinds: attributedEmails.map((e) => e.sourceKind),
            } as Prisma.InputJsonValue,
          },
        });
        return existing.id;
      }

      const created = await tx.lead.create({
        data: {
          brandCandidateId: input.brandCandidateId,
          influencerId: input.influencerId,
          runId: input.runId,
          contactName: person.name,
          title: person.title ?? null,
          email: primaryEmail,
          isGeneric: primaryEmail
            ? classifyPublicEmailGeneric(primaryEmail)
            : false,
          profileUrl,
          providerId: MASTRA_FIND_BRAND_PEOPLE_PROVIDER_ID,
          source: 'mastra-find-brand-people',
          metadata: {
            track: '2B',
            sourceKinds: attributedEmails.map((e) => e.sourceKind),
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return created.id;
    });

    const channels: CreateChannelInput[] = [
      {
        type: ContactChannelType.LINKEDIN,
        value: profileUrl,
        source: ContactChannelSource.LINKEDIN_SCRAPER,
        sourceUrl: profileUrl,
      },
    ];

    for (const email of attributedEmails) {
      const isBrandWebOrOcr =
        email.sourceKind === 'brand_web' || email.sourceKind === 'ocr';
      channels.push({
        type: ContactChannelType.EMAIL,
        value: email.email,
        source: isBrandWebOrOcr
          ? ContactChannelSource.PUBLIC_WEB
          : ContactChannelSource.LINKEDIN_SCRAPER,
        sourceUrl: email.sourceUrl,
        isGeneric: classifyPublicEmailGeneric(email.email),
        metadata: {
          discoveryStatus: 'FOUND',
          attributionStatus: 'ATTRIBUTED',
          verificationStatus: 'UNVERIFIED',
          sourceKind: email.sourceKind,
          evidences: [
            {
              sourceUrl: email.sourceUrl,
              evidenceSnippet: email.evidenceSnippet ?? email.email,
              discoveredAt: new Date().toISOString(),
              sourceKind: email.sourceKind,
            },
          ],
        } as Prisma.InputJsonValue,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.contactChannels.createChannelsForLead(tx, leadId, channels);
    });

    return { created: !existing };
  }

  private domainFromWebsite(website: string): string {
    try {
      return new URL(
        website.startsWith('http') ? website : `https://${website}`,
      ).hostname
        .toLowerCase()
        .replace(/^www\./, '');
    } catch {
      return website.toLowerCase().replace(/^www\./, '');
    }
  }

  /**
   * 2C.3 + 2C.4.5: Agency Discovery then FIND_AGENCY_EMAILS for eligible
   * InfluencerAgency rows. Soft-isolated — never throws to the caller.
   */
  private async runTrack2C(params: {
    influencerId: string;
    nicheFallback?: string | null;
    runId: string;
    userId?: string;
  }): Promise<Track2CPhaseResult> {
    const empty: Track2CPhaseResult = {
      executed: false,
      candidatesCount: 0,
      persistedCount: 0,
    };

    try {
      const influencer = await this.prisma.influencer.findUnique({
        where: { id: params.influencerId },
        select: {
          id: true,
          name: true,
          country: true,
          niche: true,
          subNiche: true,
          niches: true,
          idealBrandProfile: {
            select: {
              targetSectors: true,
              markets: true,
            },
          },
        },
      });

      const influencerName = influencer?.name?.trim();
      if (!influencer || !influencerName) {
        this.logger.warn(
          JSON.stringify({
            event: 'agency_discovery_skipped_insufficient_context',
            runId: params.runId,
            influencerId: params.influencerId,
          }),
        );
        return empty;
      }

      const niche = influencer.niche ?? params.nicheFallback ?? null;
      const niches = influencer.niches?.length ? influencer.niches : undefined;
      const markets = influencer.idealBrandProfile?.markets;

      let discoveryPhase: Track2CPhaseResult;
      try {
        const result = await this.agencyDiscovery.execute({
          operation: 'DISCOVER_AGENCIES',
          influencerId: influencer.id,
          influencerName,
          niche,
          subNiche: influencer.subNiche ?? null,
          niches,
          country: influencer.country ?? null,
          markets,
          ibpTargetSectors: influencer.idealBrandProfile?.targetSectors,
          ibpMarkets: markets,
          // Explicit defaults — AgencyDiscoveryInput is z.infer (defaults required).
          maxSerpQueries: 4,
          maxResultsPerQuery: 6,
        });

        this.logger.log(
          JSON.stringify({
            event: 'agency_discovery_track_2c_completed',
            runId: params.runId,
            influencerId: influencer.id,
            outcome: result.output.outcome,
            candidatesCount: result.output.candidates.length,
            persistedCount: result.persistedCount,
          }),
        );

        discoveryPhase = {
          executed: true,
          outcome: result.output.outcome,
          error: null,
          candidatesCount: result.output.candidates.length,
          persistedCount: result.persistedCount,
          searchMetadata: result.output.searchMetadata,
          summary: result.output.summary ?? null,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message.slice(0, 2000) : String(error);
        this.logger.warn(
          JSON.stringify({
            event: 'agency_discovery_track_2c_failed',
            runId: params.runId,
            influencerId: params.influencerId,
            errorMessage: message,
          }),
        );
        discoveryPhase = {
          executed: true,
          outcome: 'PROVIDER_FAILURE',
          error: message,
          candidatesCount: 0,
          persistedCount: 0,
        };
      }

      // 2C.4.5: emails pass uses persisted InfluencerAgency eligibility.
      let emailsPass: Track2CEmailsPassMetadata;
      try {
        emailsPass = await this.agencyContactEmails.researchEligibleAgencies({
          runId: params.runId,
          influencerId: influencer.id,
          userId: params.userId,
          niche,
          niches,
          country: influencer.country ?? null,
          markets,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message.slice(0, 2000) : String(error);
        this.logger.warn(
          JSON.stringify({
            event: 'agency_contact_emails_track_2c_failed',
            runId: params.runId,
            influencerId: influencer.id,
            errorMessage: message,
          }),
        );
        emailsPass = {
          executed: true,
          outcome: 'PROVIDER_FAILURE',
          error: message,
          agenciesInvestigated: 0,
          agenciesSucceeded: 0,
          agenciesFailed: 0,
          emailsFound: 0,
          emailsPersistedCreated: 0,
          emailsPersistedUpdated: 0,
          emailsSkipped: 0,
          emailsPersistFailed: 0,
          agencies: [],
        };
      }

      // 2C.4.6: people-pass ALWAYS — independent of emailsPass outcome.
      let peoplePass: Track2CPeoplePassMetadata;
      try {
        peoplePass = await this.agencyContactPeople.researchEligibleAgencies({
          runId: params.runId,
          influencerId: influencer.id,
          userId: params.userId,
          niche,
          niches,
          country: influencer.country ?? null,
          markets,
          emailsPass,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message.slice(0, 2000) : String(error);
        this.logger.warn(
          JSON.stringify({
            event: 'agency_contact_people_track_2c_failed',
            runId: params.runId,
            influencerId: influencer.id,
            errorMessage: message,
          }),
        );
        peoplePass = {
          executed: true,
          peoplePassPolicy: 'ALWAYS',
          outcome: 'PROVIDER_FAILURE',
          error: message,
          agenciesInvestigated: 0,
          agenciesSucceeded: 0,
          agenciesFailed: 0,
          peopleFound: 0,
          contactsPersistedCreated: 0,
          contactsPersistedUpdated: 0,
          contactsSkipped: 0,
          contactsPersistFailed: 0,
          agencies: [],
        };
      }

      return {
        ...discoveryPhase,
        emailsPass,
        peoplePass,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 2000) : String(error);
      this.logger.warn(
        JSON.stringify({
          event: 'agency_track_2c_outer_failed',
          runId: params.runId,
          influencerId: params.influencerId,
          errorMessage: message,
        }),
      );
      return {
        executed: true,
        outcome: 'PROVIDER_FAILURE',
        error: message,
        candidatesCount: 0,
        persistedCount: 0,
      };
    }
  }

  private toTrack2CMetadata(phase: Track2CPhaseResult): Track2CResultMetadata {
    if (!phase.executed) {
      return { executed: false };
    }
    return {
      executed: true,
      outcome: phase.outcome,
      error: phase.error ?? null,
      candidatesCount: phase.candidatesCount,
      persistedCount: phase.persistedCount,
      ...(phase.searchMetadata ? { searchMetadata: phase.searchMetadata } : {}),
      ...(phase.emailsPass ? { emailsPass: phase.emailsPass } : {}),
      ...(phase.peoplePass ? { peoplePass: phase.peoplePass } : {}),
    };
  }

  /**
   * True when every track that actually ran ended in provider/hard failure
   * (empty NO_MATCHES is not a failure).
   */
  private allExecutedTracksFailed(params: {
    aiOutcome2A?: string;
    track2BShouldRun: boolean;
    aiOutcome2B?: string;
    track2BError: string | null;
    phase2C: Track2CPhaseResult;
  }): boolean {
    const twoAFailed = params.aiOutcome2A === 'PROVIDER_FAILURE';
    if (!twoAFailed) return false;

    const twoBFailed = params.track2BShouldRun
      ? params.aiOutcome2B === 'PROVIDER_FAILURE' ||
        Boolean(params.track2BError)
      : true; // skipped 2B does not count as a successful track

    const twoCFailed =
      params.phase2C.executed && params.phase2C.outcome === 'PROVIDER_FAILURE';

    // Require 2C to have run and failed; otherwise keep legacy 2A+2B rule.
    return twoBFailed && twoCFailed;
  }

  private async failRun(
    runId: string,
    errorMessage: string,
    extra?: {
      executionId?: string;
      errorCode?: string;
      contactsCreated?: number;
      contactsUpdated?: number;
      partialContactsMayExist?: boolean;
      searchMetadata?: MastraSearchMetadata | Record<string, unknown>;
    },
  ): Promise<BbcDiscoveryResult> {
    const contactsCreated = extra?.contactsCreated ?? 0;
    const contactsUpdated = extra?.contactsUpdated ?? 0;
    const truncated = errorMessage.slice(0, 2000);

    this.logger.warn(
      JSON.stringify({
        event: 'contact_email_mastra_failed',
        runId,
        errorMessage: truncated,
        executionId: extra?.executionId,
        tracks:
          extra?.searchMetadata &&
          typeof extra.searchMetadata === 'object' &&
          'tracks' in extra.searchMetadata
            ? (extra.searchMetadata as { tracks?: unknown }).tracks
            : undefined,
      }),
    );

    const metadataToPersist = extra?.searchMetadata
      ? (extra.searchMetadata as Prisma.InputJsonValue)
      : extra?.executionId
        ? ({
            schemaVersion: 2,
            engine: 'mastra',
            operation: 'FIND_BRAND_EMAILS',
            executionId: extra.executionId,
            errorCode: extra.errorCode ?? null,
          } as Prisma.InputJsonValue)
        : DbNull;

    let terminalStatusPersisted = false;
    try {
      await this.prisma.leadDiscoveryRun.update({
        where: { id: runId },
        data: {
          status: LeadDiscoveryStatus.FAILED,
          errorMessage: truncated,
          searchMetadata: metadataToPersist,
        },
      });
      terminalStatusPersisted = true;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'contact_email_mastra_fail_write_failed',
          runId,
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return {
      outcome: null,
      runStatus: 'FAILED',
      errorMessage: truncated,
      searchMetadata: (extra?.searchMetadata as BbcSearchMetadataV2) ?? null,
      contactsCreated,
      contactsUpdated,
      terminalStatusPersisted,
      partialContactsMayExist: extra?.partialContactsMayExist === true,
    };
  }
}
