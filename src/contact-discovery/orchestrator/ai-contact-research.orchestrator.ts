import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../generated/prisma/client';
import { DbNull } from '../../generated/prisma/internal/prismaNamespace';
import { LeadDiscoveryStatus } from '../../generated/prisma/enums';

import { AiService } from '../../ai/ai.service';
import { sanitizeUnlockerErrorMessage } from '../../integrations/brightdata';
import { BrandBusinessContactService } from '../../lead-discovery/brand-business-contact.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BBC_BRIGHTDATA_PROVIDER_ID } from '../constants';
import { classifyAndDedupeBbcEmails } from '../extract/classify-and-dedupe';
import { extractLiteralEmailObservations } from '../extract/literal-email.extractor';
import type { BbcRawEmailObservation } from '../extract/bbc-email-candidate';
import { brandHostFromWebsite } from '../pages/bbc-page-allowlist';
import {
  BRIGHT_DATA_UNLOCKER_PORT,
  type BrightDataUnlockerPort,
} from '../port/bright-data-unlocker.port';
import type {
  BbcDiscoveryInput,
  BbcDiscoveryResult,
} from './bbc-discovery.orchestrator';
import type {
  BbcRunOutcome,
  BbcSearchMetadataV2,
} from './bbc-search-metadata';

type ResearchTraceStep = {
  iteration: number;
  action: string;
  reason: string;
  query?: string;
  url?: string;
  observation: string;
  degraded?: boolean;
};

/**
 * AI-orchestrated BBC research (demo P0/P1).
 * AI decides tools; Bright Data executes SERP + Unlocker; emails via literal extract.
 * On AI failure → explicit degraded allowlist path is NOT automatic here;
 * processor falls back to BbcDiscoveryOrchestrator.
 */
@Injectable()
export class AiContactResearchOrchestrator {
  private readonly logger = new Logger(AiContactResearchOrchestrator.name);

  constructor(
    private readonly ai: AiService,
    @Inject(BRIGHT_DATA_UNLOCKER_PORT)
    private readonly unlocker: BrightDataUnlockerPort,
    private readonly brandBusinessContacts: BrandBusinessContactService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async execute(input: BbcDiscoveryInput & { brandName?: string }): Promise<BbcDiscoveryResult> {
    if (!this.unlocker.isConfigured()) {
      return this.failRun(
        input.runId,
        'BRIGHTDATA_NOT_CONFIGURED',
        'Bright Data is not configured (missing API key)',
      );
    }

    const maxSerp =
      this.configService.get<number>('AI_RESEARCH_MAX_SERP_QUERIES') ?? 5;
    const maxPages =
      this.configService.get<number>('AI_RESEARCH_MAX_PAGES') ?? 5;
    const maxIterations =
      this.configService.get<number>('AI_RESEARCH_MAX_ITERATIONS') ?? 12;

    const brandHost = brandHostFromWebsite(input.website);
    const brandDomain =
      input.domain.trim().toLowerCase().replace(/^www\./, '') || brandHost;

    const observations: BbcRawEmailObservation[] = [];
    const htmlByUrl = new Map<string, string>();
    const executedQueries: string[] = [];
    const fetchedUrls: string[] = [];
    const steps: ResearchTraceStep[] = [];
    let serpQueriesUsed = 0;
    let pagesFetched = 0;
    let pagesFailed = 0;
    let providerFailures = 0;
    let lastObservation: string | undefined;
    let finalizeOutcome: BbcRunOutcome | null = null;
    let finalizeSummary: string | undefined;
    let aiMode: 'ai' | 'ai_unavailable' = 'ai';

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const emailsFound = [
        ...new Set(
          classifyAndDedupeBbcEmails({
            observations,
            brandDomain,
          }).accepted.map((c) => c.emailNormalized),
        ),
      ];

      let decision;
      try {
        decision = await this.ai.decideContactResearchStep({
          brandName: input.brandName ?? brandHost ?? input.website,
          website: input.website,
          domain: brandDomain,
          limits: { maxSerpQueries: maxSerp, maxPages },
          serpQueriesUsed,
          pagesFetched,
          iterationsRemaining: maxIterations - iteration + 1,
          emailsFound,
          executedQueries,
          fetchedUrls,
          lastObservation,
        });
      } catch (error) {
        const message = sanitizeUnlockerErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
        aiMode = 'ai_unavailable';
        this.logger.error(
          JSON.stringify({
            event: 'ai_contact_research_llm_failed',
            runId: input.runId,
            errorMessage: message,
          }),
        );
        return this.failRun(
          input.runId,
          'AI_PROVIDER_UNAVAILABLE',
          message,
          { degraded: true },
        );
      }

      if (decision.action === 'finalize_research') {
        finalizeOutcome = decision.finalize?.outcome ?? 'NO_MATCHES';
        finalizeSummary = decision.finalize?.summary ?? decision.reason;
        steps.push({
          iteration,
          action: decision.action,
          reason: decision.reason,
          observation: finalizeSummary ?? decision.reason,
        });
        break;
      }

      if (decision.action === 'search_web') {
        if (serpQueriesUsed >= maxSerp) {
          lastObservation = 'SERP limit reached';
          steps.push({
            iteration,
            action: 'search_web',
            reason: decision.reason,
            observation: lastObservation,
          });
          continue;
        }
        const query = decision.query?.trim();
        if (!query) {
          lastObservation = 'search_web missing query';
          continue;
        }
        serpQueriesUsed += 1;
        executedQueries.push(query);
        const search = await this.unlocker.search({ text: query, num: 8 });
        if (
          search.outcome !== 'ok' &&
          search.outcome !== 'organic_empty'
        ) {
          providerFailures += 1;
        }
        const hits = search.items.slice(0, 8).map((item) => ({
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          position: item.position,
        }));
        lastObservation = JSON.stringify({
          tool: 'search_web',
          outcome: search.outcome,
          hits,
        }).slice(0, 1500);
        steps.push({
          iteration,
          action: 'search_web',
          reason: decision.reason,
          query,
          observation: `outcome=${search.outcome}; hits=${hits.length}`,
        });
        continue;
      }

      if (decision.action === 'fetch_page') {
        if (pagesFetched >= maxPages) {
          lastObservation = 'page fetch limit reached';
          continue;
        }
        const url = decision.url?.trim();
        if (!url || !/^https?:\/\//i.test(url)) {
          lastObservation = 'fetch_page invalid url';
          continue;
        }
        if (fetchedUrls.includes(url)) {
          lastObservation = `url already fetched: ${url}`;
          continue;
        }
        pagesFetched += 1;
        fetchedUrls.push(url);
        const fetched = await this.unlocker.fetchHtml(url);
        if (fetched.outcome !== 'ok') {
          pagesFailed += 1;
          providerFailures += 1;
          lastObservation = `fetch_page outcome=${fetched.outcome} status=${fetched.httpStatus}`;
        } else {
          htmlByUrl.set(url, fetched.html);
          lastObservation = `fetch_page ok bodyLength=${fetched.bodyLength}`;
        }
        steps.push({
          iteration,
          action: 'fetch_page',
          reason: decision.reason,
          url,
          observation: lastObservation,
        });
        continue;
      }

      if (decision.action === 'extract_emails') {
        const url = decision.url?.trim();
        if (!url || !htmlByUrl.has(url)) {
          lastObservation = 'extract_emails requires a previously fetched url';
          continue;
        }
        const html = htmlByUrl.get(url) ?? '';
        const found = extractLiteralEmailObservations({
          text: html,
          sourceUrl: url,
        });
        observations.push(...found);
        lastObservation = `extract_emails found=${found.length} on ${url}`;
        steps.push({
          iteration,
          action: 'extract_emails',
          reason: decision.reason,
          url,
          observation: lastObservation,
        });
        continue;
      }
    }

    if (!finalizeOutcome) {
      finalizeOutcome =
        observations.length > 0
          ? 'RESULTS_FOUND'
          : providerFailures > 0
            ? 'PROVIDER_FAILURE'
            : 'NO_MATCHES';
      finalizeSummary = 'Auto-finalize: iteration or tool budget exhausted';
    }

    // Re-extract from all fetched pages if AI skipped extract (safety).
    for (const [url, html] of htmlByUrl) {
      observations.push(
        ...extractLiteralEmailObservations({ text: html, sourceUrl: url }),
      );
    }

    const classified = classifyAndDedupeBbcEmails({
      observations,
      brandDomain,
    });

    let contactsCreated = 0;
    let contactsUpdated = 0;
    try {
      for (const candidate of classified.accepted) {
        let created = false;
        let updated = false;
        for (const evidence of candidate.evidences) {
          const upsert = await this.brandBusinessContacts.upsertFromDiscovery({
            brandCandidateId: input.brandCandidateId,
            email: candidate.emailNormalized,
            sourceUrl: evidence.sourceUrl,
            evidenceSnippet: evidence.evidenceSnippet,
            commercialRelevance: candidate.commercialRelevance,
            isGeneric: candidate.isGeneric,
            label: candidate.label,
          });
          created = created || upsert.created;
          updated = updated || upsert.updated;
        }
        if (created) contactsCreated += 1;
        else if (updated) contactsUpdated += 1;
      }
    } catch (error) {
      const message = sanitizeUnlockerErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      return this.failRun(input.runId, 'CONTACT_PERSIST_FAILED', message, {
        contactsCreated,
        contactsUpdated,
        partialContactsMayExist: contactsCreated + contactsUpdated > 0,
      });
    }

    const contactsPersisted = contactsCreated + contactsUpdated;
    let outcome: BbcRunOutcome = finalizeOutcome;
    if (contactsPersisted > 0) {
      outcome = 'RESULTS_FOUND';
    } else if (outcome === 'RESULTS_FOUND') {
      outcome = providerFailures > 0 ? 'PROVIDER_FAILURE' : 'NO_MATCHES';
    }

    const searchMetadata: BbcSearchMetadataV2 & {
      researchTrace?: Record<string, unknown>;
      orchestrationMode?: string;
    } = {
      schemaVersion: 2,
      providerId: BBC_BRIGHTDATA_PROVIDER_ID,
      outcome,
      ...(outcome === 'PROVIDER_FAILURE'
        ? {
            providerFailureKind: 'empty_body' as const,
            errorSummary: {
              code: 'BBC_PROVIDER_FAILURE',
              message: finalizeSummary ?? 'Provider failures during AI research',
              retryable: true,
            },
          }
        : {}),
      businessContacts: {
        created: contactsCreated,
        updated: contactsUpdated,
        emailsFound: classified.accepted.length,
        pagesAttempted: pagesFetched,
        pagesSucceeded: pagesFetched - pagesFailed,
        pagesFailed,
        failureCountsByCategory:
          providerFailures > 0 ? { provider: providerFailures } : {},
        discardCountsByReason: Object.fromEntries(
          Object.entries(classified.discardCountsByReason).filter(
            ([, count]) => (count ?? 0) > 0,
          ),
        ) as Record<string, number>,
        pageResults: fetchedUrls.map((url) => ({
          url,
          outcome: htmlByUrl.has(url) ? 'ok' : 'empty_body',
          apiHttpStatus: htmlByUrl.has(url) ? 200 : 0,
          bodyLength: htmlByUrl.get(url)?.length ?? 0,
          elapsedMs: 0,
          zone: 'unlocker',
          providerFailureKind: htmlByUrl.has(url)
            ? null
            : ('empty_body' as const),
        })),
      },
      orchestrationMode: aiMode,
      researchTrace: {
        mode: 'ai',
        serpQueriesUsed,
        pagesFetched,
        maxSerp,
        maxPages,
        steps,
        finalizeSummary,
      },
    };

    try {
      await this.prisma.leadDiscoveryRun.update({
        where: { id: input.runId },
        data: {
          status: LeadDiscoveryStatus.COMPLETED,
          errorMessage: null,
          searchMetadata: searchMetadata as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      const message = sanitizeUnlockerErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      return this.failRun(input.runId, 'RUN_COMPLETED_PERSIST_FAILED', message, {
        contactsCreated,
        contactsUpdated,
        partialContactsMayExist: contactsPersisted > 0,
      });
    }

    this.logger.log(
      JSON.stringify({
        event: 'ai_contact_research_completed',
        runId: input.runId,
        outcome,
        contactsCreated,
        contactsUpdated,
        serpQueriesUsed,
        pagesFetched,
      }),
    );

    return {
      outcome,
      runStatus: 'COMPLETED',
      errorMessage: null,
      searchMetadata: searchMetadata as BbcSearchMetadataV2,
      contactsCreated,
      contactsUpdated,
      terminalStatusPersisted: true,
      partialContactsMayExist: false,
    };
  }

  private async failRun(
    runId: string,
    code: string,
    message: string,
    options: {
      contactsCreated?: number;
      contactsUpdated?: number;
      partialContactsMayExist?: boolean;
      degraded?: boolean;
    } = {},
  ): Promise<BbcDiscoveryResult> {
    const errorMessage = `${code}: ${message}`;
    const contactsCreated = options.contactsCreated ?? 0;
    const contactsUpdated = options.contactsUpdated ?? 0;
    const partialContactsMayExist = options.partialContactsMayExist ?? false;

    try {
      await this.prisma.leadDiscoveryRun.update({
        where: { id: runId },
        data: {
          status: LeadDiscoveryStatus.FAILED,
          errorMessage,
          searchMetadata: options.degraded
            ? ({
                schemaVersion: 2,
                providerId: BBC_BRIGHTDATA_PROVIDER_ID,
                orchestrationMode: 'ai_unavailable_degraded',
                outcome: null,
              } as unknown as Prisma.InputJsonValue)
            : DbNull,
        },
      });
      return {
        outcome: null,
        runStatus: 'FAILED',
        errorMessage,
        searchMetadata: null,
        contactsCreated,
        contactsUpdated,
        terminalStatusPersisted: true,
        partialContactsMayExist,
      };
    } catch (persistError) {
      const persistMessage = sanitizeUnlockerErrorMessage(
        persistError instanceof Error
          ? persistError.message
          : String(persistError),
      );
      return {
        outcome: null,
        runStatus: 'FAILED',
        errorMessage: `${errorMessage} | FAILED_STATUS_NOT_PERSISTED: ${persistMessage}`,
        searchMetadata: null,
        contactsCreated,
        contactsUpdated,
        terminalStatusPersisted: false,
        partialContactsMayExist,
      };
    }
  }
}
