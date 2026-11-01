import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { DbNull } from '../../generated/prisma/internal/prismaNamespace';
import { LeadDiscoveryStatus } from '../../generated/prisma/enums';

import { BrandBusinessContactService } from '../../lead-discovery/brand-business-contact.service';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeUnlockerErrorMessage } from '../../integrations/brightdata';
import { BBC_BRIGHTDATA_PROVIDER_ID } from '../constants';
import { classifyAndDedupeBbcEmails } from '../extract/classify-and-dedupe';
import { extractLiteralEmailObservations } from '../extract/literal-email.extractor';
import type { BbcRawEmailObservation } from '../extract/bbc-email-candidate';
import {
  BBC_V1_DEFAULT_MAX_PAGES,
  buildBbcV1PageUrls,
  brandHostFromWebsite,
} from '../pages/bbc-page-allowlist';
import {
  BRIGHT_DATA_UNLOCKER_PORT,
  type BrightDataUnlockerPort,
} from '../port/bright-data-unlocker.port';
import {
  pickPrimaryProviderFailureKind,
  resolveBbcRunOutcome,
  type BbcPageAttemptResult,
  type BbcRunOutcome,
  type BbcSearchMetadataV2,
} from './bbc-search-metadata';

export type BbcDiscoveryInput = {
  runId: string;
  brandCandidateId: string;
  website: string;
  domain: string;
  maxPages?: number;
};

/**
 * Persistence of contacts and run status is **not** a single DB transaction.
 * If upserts succeed and a later step fails, BBC rows may already exist.
 */
export type BbcDiscoveryResult = {
  outcome: BbcRunOutcome | null;
  runStatus: 'COMPLETED' | 'FAILED';
  errorMessage: string | null;
  searchMetadata: BbcSearchMetadataV2 | null;
  contactsCreated: number;
  contactsUpdated: number;
  /** True only when the terminal COMPLETED/FAILED write to LeadDiscoveryRun succeeded. */
  terminalStatusPersisted: boolean;
  /**
   * True when at least one contact upsert succeeded before a later failure,
   * or when COMPLETED write failed after upserts (orphaned BBC relative to run metadata).
   */
  partialContactsMayExist: boolean;
};

type FailRunOptions = {
  contactsCreated?: number;
  contactsUpdated?: number;
  partialContactsMayExist?: boolean;
};

/**
 * BBC v1 orchestrator (T3): allowlist pages → Unlocker port → extract →
 * classify/dedupe → BrandBusinessContact upsert → LeadDiscoveryRun metadata v2.
 * Registered via ContactDiscoveryModule (T4). Search Unlocker not called here.
 */
@Injectable()
export class BbcDiscoveryOrchestrator {
  private readonly logger = new Logger(BbcDiscoveryOrchestrator.name);

  constructor(
    @Inject(BRIGHT_DATA_UNLOCKER_PORT)
    private readonly unlocker: BrightDataUnlockerPort,
    private readonly brandBusinessContacts: BrandBusinessContactService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: BbcDiscoveryInput): Promise<BbcDiscoveryResult> {
    if (!this.unlocker.isConfigured()) {
      return this.failRun(
        input.runId,
        'BRIGHTDATA_NOT_CONFIGURED',
        'Bright Data Unlocker is not configured (missing API key)',
      );
    }

    const maxPages = input.maxPages ?? BBC_V1_DEFAULT_MAX_PAGES;
    const pageUrls = buildBbcV1PageUrls(input.website, maxPages);
    if (pageUrls.length === 0) {
      return this.failRun(
        input.runId,
        'INVALID_WEBSITE',
        `No BBC pages could be built for website=${input.website}`,
      );
    }

    const pageResults: BbcPageAttemptResult[] = [];
    const observations: BbcRawEmailObservation[] = [];
    let pagesSucceeded = 0;
    let pagesFailed = 0;
    const failureCountsByCategory: Record<string, number> = {};

    for (const pageUrl of pageUrls) {
      try {
        const fetched = await this.unlocker.fetchHtml(pageUrl);
        const attempt: BbcPageAttemptResult = {
          url: pageUrl,
          outcome: fetched.outcome,
          apiHttpStatus: fetched.httpStatus,
          bodyLength: fetched.bodyLength,
          elapsedMs: fetched.elapsedMs,
          zone: fetched.zone,
          providerFailureKind: fetched.providerFailureKind,
          ...(fetched.errorName ? { errorName: fetched.errorName } : {}),
          ...(fetched.errorMessage
            ? { errorMessage: fetched.errorMessage }
            : {}),
          ...(fetched.causeCode ? { causeCode: fetched.causeCode } : {}),
        };
        pageResults.push(attempt);

        if (fetched.outcome !== 'ok') {
          pagesFailed += 1;
          const category = fetched.providerFailureKind ?? fetched.outcome;
          failureCountsByCategory[category] =
            (failureCountsByCategory[category] ?? 0) + 1;
          continue;
        }

        pagesSucceeded += 1;
        observations.push(
          ...extractLiteralEmailObservations({
            text: fetched.html,
            sourceUrl: pageUrl,
          }),
        );
      } catch (error) {
        // DEF-2: unexpected throw — not NO_MATCHES; count as provider/page failure.
        const errorName = error instanceof Error ? error.name : 'Error';
        const errorMessage = sanitizeUnlockerErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
        pagesFailed += 1;
        failureCountsByCategory.transport =
          (failureCountsByCategory.transport ?? 0) + 1;
        pageResults.push({
          url: pageUrl,
          outcome: 'unknown_error',
          apiHttpStatus: 0,
          bodyLength: 0,
          elapsedMs: 0,
          zone: 'unknown',
          providerFailureKind: 'transport',
          errorName,
          errorMessage,
        });
        this.logger.warn(
          JSON.stringify({
            event: 'bbc_discovery_fetch_threw',
            runId: input.runId,
            pageUrl,
            errorName,
            errorMessage,
          }),
        );
      }
    }

    const brandDomain =
      input.domain.trim().toLowerCase().replace(/^www\./, '') ||
      brandHostFromWebsite(input.website);

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
        if (created) {
          contactsCreated += 1;
        } else if (updated) {
          contactsUpdated += 1;
        }
      }
    } catch (error) {
      // DEF-1: contact persistence failed. Upserts are not transactional —
      // earlier candidates in this loop may already be in BrandBusinessContact.
      const message = sanitizeUnlockerErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      this.logger.error(
        JSON.stringify({
          event: 'bbc_discovery_contact_persist_failed',
          runId: input.runId,
          contactsCreatedBeforeFailure: contactsCreated,
          contactsUpdatedBeforeFailure: contactsUpdated,
          errorName: error instanceof Error ? error.name : 'Error',
          errorMessage: message,
        }),
      );
      return this.failRun(
        input.runId,
        'CONTACT_PERSIST_FAILED',
        message,
        {
          contactsCreated,
          contactsUpdated,
          // Non-transactional: only true if at least one upsert already succeeded.
          partialContactsMayExist: contactsCreated + contactsUpdated > 0,
        },
      );
    }

    const contactsPersisted = contactsCreated + contactsUpdated;
    const outcome = resolveBbcRunOutcome({
      contactsPersisted,
      pageResults,
    });
    const providerFailureKind =
      outcome === 'PROVIDER_FAILURE'
        ? pickPrimaryProviderFailureKind(pageResults)
        : undefined;

    const searchMetadata: BbcSearchMetadataV2 = {
      schemaVersion: 2,
      providerId: BBC_BRIGHTDATA_PROVIDER_ID,
      outcome,
      ...(providerFailureKind ? { providerFailureKind } : {}),
      ...(outcome === 'PROVIDER_FAILURE'
        ? {
            errorSummary: {
              code: 'BBC_PROVIDER_FAILURE',
              message: providerFailureKind
                ? `Bright Data Unlocker failure: ${providerFailureKind}`
                : 'Bright Data Unlocker returned no usable content',
              retryable:
                providerFailureKind === 'transport' ||
                providerFailureKind === 'http' ||
                providerFailureKind === 'empty_body',
            },
          }
        : {}),
      businessContacts: {
        created: contactsCreated,
        updated: contactsUpdated,
        emailsFound: classified.accepted.length,
        pagesAttempted: pageResults.length,
        pagesSucceeded,
        pagesFailed,
        failureCountsByCategory,
        discardCountsByReason: Object.fromEntries(
          Object.entries(classified.discardCountsByReason).filter(
            ([, count]) => (count ?? 0) > 0,
          ),
        ) as Record<string, number>,
        pageResults,
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
      // DEF-1: contacts may already be saved; do not report COMPLETED success.
      const message = sanitizeUnlockerErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      this.logger.error(
        JSON.stringify({
          event: 'bbc_discovery_completed_status_persist_failed',
          runId: input.runId,
          outcome,
          contactsCreated,
          contactsUpdated,
          errorName: error instanceof Error ? error.name : 'Error',
          errorMessage: message,
        }),
      );
      return this.failRun(
        input.runId,
        'RUN_COMPLETED_PERSIST_FAILED',
        message,
        {
          contactsCreated,
          contactsUpdated,
          partialContactsMayExist: contactsPersisted > 0,
        },
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'bbc_discovery_completed',
        runId: input.runId,
        outcome,
        contactsCreated,
        contactsUpdated,
        pagesAttempted: pageResults.length,
        pagesFailed,
      }),
    );

    return {
      outcome,
      runStatus: 'COMPLETED',
      errorMessage: null,
      searchMetadata,
      contactsCreated,
      contactsUpdated,
      terminalStatusPersisted: true,
      partialContactsMayExist: false,
    };
  }

  /**
   * Attempts to persist FAILED. If that write also fails, returns
   * `terminalStatusPersisted: false` and never claims FAILED was stored.
   */
  private async failRun(
    runId: string,
    code: string,
    message: string,
    options: FailRunOptions = {},
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
          searchMetadata: DbNull,
        },
      });
      this.logger.warn(
        JSON.stringify({
          event: 'bbc_discovery_failed',
          runId,
          code,
          message,
          terminalStatusPersisted: true,
          partialContactsMayExist,
          contactsCreated,
          contactsUpdated,
        }),
      );
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
      this.logger.error(
        JSON.stringify({
          event: 'bbc_discovery_failed_status_persist_failed',
          runId,
          originalCode: code,
          originalMessage: message,
          persistErrorName:
            persistError instanceof Error ? persistError.name : 'Error',
          persistErrorMessage: persistMessage,
          terminalStatusPersisted: false,
          partialContactsMayExist,
          contactsCreated,
          contactsUpdated,
        }),
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
