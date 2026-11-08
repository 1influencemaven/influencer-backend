import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../generated/prisma/client';
import { DbNull } from '../../generated/prisma/internal/prismaNamespace';
import { LeadDiscoveryStatus } from '../../generated/prisma/enums';

import { AiExecutionPublisherService } from '../../ai-execution/ai-execution-publisher.service';
import { AiExecutionWaitError } from '../../ai-execution/ai-execution-result-wait.errors';
import { AiExecutionResultWaitService } from '../../ai-execution/ai-execution-result-wait.service';
import { BrandBusinessContactService } from '../../lead-discovery/brand-business-contact.service';
import { classifyCommercialRelevance } from '../../lead-discovery/utils/commercial-relevance.util';
import { classifyPublicEmailGeneric } from '../../lead-discovery/utils/public-email-generic.util';
import { PrismaService } from '../../prisma/prisma.service';
import { MASTRA_CONTACT_EMAILS_PROVIDER_ID } from '../constants';
import type { BbcDiscoveryResult } from './bbc-discovery.types';
import type {
  BbcRunOutcome,
  BbcSearchMetadataV2,
} from './bbc-search-metadata';

/** Tool-loop + LLM can take several minutes (SERP + Unlocker). */
export const CONTACT_EMAIL_MASTRA_TIMEOUT_MS = 300_000;

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
};

type MastraSearchMetadata = BbcSearchMetadataV2 & {
  engine: 'mastra';
  operation: 'FIND_BRAND_EMAILS';
  executionId: string;
  aiOutcome?: string;
  summary?: string | null;
  trace?: Prisma.InputJsonValue | null;
};

/**
 * Paso 3 — publish FIND_BRAND_EMAILS → wait Mastra → upsert BrandBusinessContact.
 * Returns the same {@link BbcDiscoveryResult} shape so the existing processor can interpret it.
 */
@Injectable()
export class ContactEmailMastraOrchestrator {
  private readonly logger = new Logger(ContactEmailMastraOrchestrator.name);

  constructor(
    private readonly publisher: AiExecutionPublisherService,
    private readonly resultWait: AiExecutionResultWaitService,
    private readonly brandBusinessContacts: BrandBusinessContactService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async execute(input: ContactEmailMastraInput): Promise<BbcDiscoveryResult> {
    const maxSerpQueries =
      this.configService.get<number>('AI_RESEARCH_MAX_SERP_QUERIES') ?? 5;
    const maxPages =
      input.maxPages ??
      this.configService.get<number>('AI_RESEARCH_MAX_PAGES') ??
      5;

    const domain =
      input.domain.trim().toLowerCase().replace(/^www\./, '') ||
      this.domainFromWebsite(input.website);

    let executionId: string;
    try {
      const published =
        await this.publisher.publishContactResearchFindBrandEmails({
          runId: input.runId,
          userId: input.userId ?? 'system:contact-email-mastra',
          influencerId: input.influencerId,
          brandName: input.brandName?.trim() || domain,
          website: input.website,
          domain,
          niche: input.niche,
          maxSerpQueries,
          maxPages,
        });
      executionId = published.executionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failRun(input.runId, `PUBLISH_FAILED: ${message}`);
    }

    this.logger.log(
      JSON.stringify({
        event: 'contact_email_mastra_published',
        runId: input.runId,
        executionId,
      }),
    );

    let aiResult;
    try {
      aiResult = await this.resultWait.waitForAiExecutionResult(
        executionId,
        CONTACT_EMAIL_MASTRA_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof AiExecutionWaitError) {
        return this.failRun(input.runId, `${error.code}: ${error.message}`, {
          executionId,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      return this.failRun(input.runId, `WAIT_FAILED: ${message}`, {
        executionId,
      });
    }

    if (aiResult.type !== 'CONTACT_RESEARCH') {
      return this.failRun(
        input.runId,
        `Unexpected AI result type=${aiResult.type}`,
        { executionId },
      );
    }

    if (aiResult.status !== 'COMPLETED' || !aiResult.output) {
      return this.failRun(
        input.runId,
        aiResult.error?.message ??
          `AI execution ${aiResult.status} without output`,
        { executionId, errorCode: aiResult.error?.code },
      );
    }

    if (aiResult.output.operation !== 'FIND_BRAND_EMAILS') {
      return this.failRun(
        input.runId,
        `Unexpected CONTACT_RESEARCH operation=${aiResult.output.operation}`,
        { executionId },
      );
    }

    const output = aiResult.output;
    let contactsCreated = 0;
    let contactsUpdated = 0;

    try {
      for (const item of output.emails) {
        const upsert = await this.brandBusinessContacts.upsertFromDiscovery({
          brandCandidateId: input.brandCandidateId,
          email: item.email,
          sourceUrl: item.sourceUrl,
          evidenceSnippet: item.evidenceSnippet ?? item.email,
          commercialRelevance: classifyCommercialRelevance(item.email),
          isGeneric: classifyPublicEmailGeneric(item.email),
        });
        if (upsert.created) contactsCreated += 1;
        else if (upsert.updated) contactsUpdated += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failRun(input.runId, `CONTACT_PERSIST_FAILED: ${message}`, {
        executionId,
        contactsCreated,
        contactsUpdated,
        partialContactsMayExist: contactsCreated + contactsUpdated > 0,
      });
    }

    const contactsPersisted = contactsCreated + contactsUpdated;
    let outcome: BbcRunOutcome;
    if (output.outcome === 'PROVIDER_FAILURE' && contactsPersisted === 0) {
      outcome = 'PROVIDER_FAILURE';
    } else if (contactsPersisted > 0) {
      outcome = 'RESULTS_FOUND';
    } else {
      outcome = 'NO_MATCHES';
    }

    const pages = output.trace?.pages ?? [];
    const searchMetadata: MastraSearchMetadata = {
      schemaVersion: 2,
      providerId: 'bbc-brightdata',
      outcome,
      businessContacts: {
        created: contactsCreated,
        updated: contactsUpdated,
        emailsFound: output.emails.length,
        pagesAttempted: output.trace?.pageCalls ?? pages.length,
        pagesSucceeded: pages.length,
        pagesFailed: 0,
        failureCountsByCategory: {},
        discardCountsByReason: {},
        pageResults: pages.map((url) => ({
          url,
          outcome: 'ok',
          apiHttpStatus: 200,
          bodyLength: 0,
          elapsedMs: 0,
          zone: 'mastra',
          providerFailureKind: null,
        })),
      },
      engine: 'mastra',
      operation: 'FIND_BRAND_EMAILS',
      executionId,
      aiOutcome: output.outcome,
      summary: output.summary ?? null,
      trace: (output.trace ?? null) as Prisma.InputJsonValue | null,
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
        contactsCreated,
        contactsUpdated,
        terminalStatusPersisted: false,
        partialContactsMayExist: contactsPersisted > 0,
      };
    }

    this.logger.log(
      JSON.stringify({
        event: 'contact_email_mastra_completed',
        runId: input.runId,
        executionId,
        outcome,
        contactsCreated,
        contactsUpdated,
        providerId: MASTRA_CONTACT_EMAILS_PROVIDER_ID,
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

  private async failRun(
    runId: string,
    errorMessage: string,
    extra?: {
      executionId?: string;
      errorCode?: string;
      contactsCreated?: number;
      contactsUpdated?: number;
      partialContactsMayExist?: boolean;
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
      }),
    );

    let terminalStatusPersisted = false;
    try {
      await this.prisma.leadDiscoveryRun.update({
        where: { id: runId },
        data: {
          status: LeadDiscoveryStatus.FAILED,
          errorMessage: truncated,
          searchMetadata: extra?.executionId
            ? {
                schemaVersion: 2,
                engine: 'mastra',
                operation: 'FIND_BRAND_EMAILS',
                executionId: extra.executionId,
                errorCode: extra.errorCode ?? null,
              }
            : DbNull,
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
      searchMetadata: null,
      contactsCreated,
      contactsUpdated,
      terminalStatusPersisted,
      partialContactsMayExist: extra?.partialContactsMayExist === true,
    };
  }
}
