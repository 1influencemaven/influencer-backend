import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  contactResearchFindAgencyEmailsOutputSchema,
  type AgencyContactFoundEmail,
  type ContactResearchPageSnapshot,
} from '@influence-maven/ai-contracts';

import { AiPromptsService } from '../ai-prompts/ai-prompts.service';
import { AiExecutionPublisherService } from '../ai-execution/ai-execution-publisher.service';
import { AiExecutionWaitError } from '../ai-execution/ai-execution-result-wait.errors';
import { AiExecutionResultWaitService } from '../ai-execution/ai-execution-result-wait.service';
import { CommercialRelevance } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AgencyContactPersistenceService } from './agency-contact-persistence.service';
import { mapPool } from '../brand-discovery/utils/map-pool.util';
import {
  AGENCY_CONTACT_ELIGIBLE_RELEVANCE,
  AGENCY_RESEARCH_CONCURRENCY,
  isAgencyEligibleForContactResearch,
  rankAgencyAssociations,
} from './utils/agency-contact-eligibility.util';

/** Per-agency Mastra wait (same order as brand 2A). */
export const AGENCY_CONTACT_EMAILS_TIMEOUT_MS = 300_000;

/** Soft cap — sequential waits; avoids unbounded Lead Discovery duration. */
export const AGENCY_CONTACT_EMAILS_MAX_AGENCIES_PER_RUN = 5;

export type Track2CEmailsPassAgencyResult = {
  agencyId: string;
  domain: string;
  relevanceStatus: string;
  outcome:
    | 'RESULTS_FOUND'
    | 'NO_MATCHES'
    | 'PROVIDER_FAILURE'
    | 'INVALID_OUTPUT'
    | 'PUBLISH_FAILED'
    | 'WAIT_FAILED'
    | 'SKIPPED_INELIGIBLE'
    | 'SKIPPED_NO_WEBSITE';
  executionId?: string;
  emailsFound: number;
  emailsPersistedCreated: number;
  emailsPersistedUpdated: number;
  emailsSkipped: number;
  emailsPersistFailed: number;
  error?: string | null;
  /**
   * Same-run RF-04 snapshots for FIND_AGENCY_PEOPLE (in-memory bridge only).
   * Never persisted to Redis / LeadDiscoveryRun as HTML cache.
   */
  pageSnapshots?: ContactResearchPageSnapshot[];
};

/**
 * Aggregate emails-pass status for track2C metadata.
 * Distinguishes not-run / success / empty / fail / partial persist.
 */
export type Track2CEmailsPassMetadata = {
  executed: boolean;
  outcome?:
    | 'RESULTS_FOUND'
    | 'NO_MATCHES'
    | 'PROVIDER_FAILURE'
    | 'PARTIAL'
    | 'SKIPPED_NO_ELIGIBLE';
  agenciesInvestigated?: number;
  agenciesSucceeded?: number;
  agenciesFailed?: number;
  emailsFound?: number;
  emailsPersistedCreated?: number;
  emailsPersistedUpdated?: number;
  emailsSkipped?: number;
  emailsPersistFailed?: number;
  error?: string | null;
  agencies?: Track2CEmailsPassAgencyResult[];
};

export type AgencyContactEmailsResearchInput = {
  runId: string;
  influencerId: string;
  userId?: string;
  niche?: string | null;
  niches?: string[];
  country?: string | null;
  markets?: string[];
  /** Optional snapshot of Settings Lead Discovery instructions. */
  promptInstructions?: string;
};

/**
 * 2C.4.5 — Nest publish/wait/persist for FIND_AGENCY_EMAILS.
 * Soft-isolated from brand 2A/2B; never touches BBC / Lead / ContactChannel.
 */
@Injectable()
export class AgencyContactEmailsResearchService {
  private readonly logger = new Logger(AgencyContactEmailsResearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: AiExecutionPublisherService,
    private readonly resultWait: AiExecutionResultWaitService,
    private readonly agencyContacts: AgencyContactPersistenceService,
    private readonly configService: ConfigService,
    @Optional()
    private readonly aiPromptsService?: AiPromptsService,
  ) {}

  async researchEligibleAgencies(
    input: AgencyContactEmailsResearchInput,
  ): Promise<Track2CEmailsPassMetadata> {
    const maxAgencies =
      this.configService.get<number>('AI_AGENCY_EMAILS_MAX_AGENCIES') ??
      AGENCY_CONTACT_EMAILS_MAX_AGENCIES_PER_RUN;
    const maxSerpQueries =
      this.configService.get<number>('AI_RESEARCH_MAX_SERP_QUERIES') ?? 5;
    const maxPages =
      this.configService.get<number>('AI_RESEARCH_MAX_PAGES') ?? 5;
    const userId = input.userId ?? 'system:agency-contact-emails';

    const fetched = await this.prisma.influencerAgency.findMany({
      where: {
        influencerId: input.influencerId,
        relevanceStatus: { in: [...AGENCY_CONTACT_ELIGIBLE_RELEVANCE] },
      },
      // Over-fetch, then keep RELEVANT before UNDER_REVIEW (see rankAgencyAssociations).
      take: Math.max(1, maxAgencies) * 3,
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        relevanceStatus: true,
        evidenceUrls: true,
        agency: {
          select: {
            id: true,
            name: true,
            website: true,
            domain: true,
          },
        },
      },
    });
    const associations = rankAgencyAssociations(fetched).slice(
      0,
      Math.max(1, maxAgencies),
    );

    if (associations.length === 0) {
      return {
        executed: true,
        outcome: 'SKIPPED_NO_ELIGIBLE',
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

    const promptInstructions =
      input.promptInstructions?.trim() ||
      (this.aiPromptsService
        ? await this.aiPromptsService.getLeadDiscoveryInstructions()
        : undefined);

    // Agencies are independent: research up to AGENCY_RESEARCH_CONCURRENCY at once
    // (order of results is preserved for metadata).
    const agencyResults = await mapPool(
      associations,
      AGENCY_RESEARCH_CONCURRENCY,
      async (row): Promise<Track2CEmailsPassAgencyResult> => {
        const agency = row.agency;
        if (!isAgencyEligibleForContactResearch(row.relevanceStatus)) {
          return {
            agencyId: agency.id,
            domain: agency.domain,
            relevanceStatus: row.relevanceStatus,
            outcome: 'SKIPPED_INELIGIBLE',
            emailsFound: 0,
            emailsPersistedCreated: 0,
            emailsPersistedUpdated: 0,
            emailsSkipped: 0,
            emailsPersistFailed: 0,
          };
        }

        const domain = agency.domain
          .trim()
          .toLowerCase()
          .replace(/^www\./, '');
        const website =
          agency.website?.trim() || (domain ? `https://${domain}` : '');
        if (!domain || !website) {
          return {
            agencyId: agency.id,
            domain: agency.domain,
            relevanceStatus: row.relevanceStatus,
            outcome: 'SKIPPED_NO_WEBSITE',
            emailsFound: 0,
            emailsPersistedCreated: 0,
            emailsPersistedUpdated: 0,
            emailsSkipped: 0,
            emailsPersistFailed: 0,
            error: 'Agency missing domain/website',
          };
        }

        return this.researchOneAgency({
          runId: input.runId,
          userId,
          influencerId: input.influencerId,
          agencyId: agency.id,
          agencyName: agency.name,
          website,
          domain,
          relevanceStatus: row.relevanceStatus,
          evidenceUrls: row.evidenceUrls,
          niche: input.niche,
          niches: input.niches,
          country: input.country,
          markets: input.markets,
          maxSerpQueries,
          maxPages,
          promptInstructions,
        });
      },
    );

    return this.aggregate(agencyResults);
  }

  private async researchOneAgency(params: {
    runId: string;
    userId: string;
    influencerId: string;
    agencyId: string;
    agencyName: string;
    website: string;
    domain: string;
    relevanceStatus: string;
    evidenceUrls: string[];
    niche?: string | null;
    niches?: string[];
    country?: string | null;
    markets?: string[];
    maxSerpQueries: number;
    maxPages: number;
    promptInstructions?: string;
  }): Promise<Track2CEmailsPassAgencyResult> {
    const base: Track2CEmailsPassAgencyResult = {
      agencyId: params.agencyId,
      domain: params.domain,
      relevanceStatus: params.relevanceStatus,
      outcome: 'NO_MATCHES',
      emailsFound: 0,
      emailsPersistedCreated: 0,
      emailsPersistedUpdated: 0,
      emailsSkipped: 0,
      emailsPersistFailed: 0,
    };

    let executionId: string;
    try {
      const published =
        await this.publisher.publishContactResearchFindAgencyEmails({
          runId: params.runId,
          userId: params.userId,
          influencerId: params.influencerId,
          agencyId: params.agencyId,
          agencyName: params.agencyName,
          website: params.website,
          domain: params.domain,
          niche: params.niche,
          niches: params.niches,
          country: params.country,
          markets: params.markets,
          maxSerpQueries: params.maxSerpQueries,
          maxPages: params.maxPages,
          ...(params.promptInstructions
            ? { promptInstructions: params.promptInstructions }
            : {}),
          ...(params.evidenceUrls.length
            ? { seedUrls: params.evidenceUrls }
            : {}),
        });
      executionId = published.executionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        outcome: 'PUBLISH_FAILED',
        error: `PUBLISH_FAILED: ${message}`.slice(0, 2000),
      };
    }

    base.executionId = executionId;

    this.logger.log(
      JSON.stringify({
        event: 'agency_contact_emails_published',
        runId: params.runId,
        agencyId: params.agencyId,
        executionId,
      }),
    );

    let aiResult;
    try {
      aiResult = await this.resultWait.waitForAiExecutionResult(
        executionId,
        AGENCY_CONTACT_EMAILS_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof AiExecutionWaitError) {
        return {
          ...base,
          outcome: 'WAIT_FAILED',
          error: `${error.code}: ${error.message}`.slice(0, 2000),
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        outcome: 'WAIT_FAILED',
        error: `WAIT_FAILED: ${message}`.slice(0, 2000),
      };
    }

    if (aiResult.type !== 'CONTACT_RESEARCH') {
      return {
        ...base,
        outcome: 'INVALID_OUTPUT',
        error: `Unexpected AI result type=${aiResult.type}`,
      };
    }

    if (aiResult.status !== 'COMPLETED' || !aiResult.output) {
      return {
        ...base,
        outcome: 'PROVIDER_FAILURE',
        error: (
          aiResult.error?.message ??
          `AI execution ${aiResult.status} without output`
        ).slice(0, 2000),
      };
    }

    if (aiResult.output.operation !== 'FIND_AGENCY_EMAILS') {
      return {
        ...base,
        outcome: 'INVALID_OUTPUT',
        error: `Unexpected CONTACT_RESEARCH operation=${aiResult.output.operation}`,
      };
    }

    const parsed = contactResearchFindAgencyEmailsOutputSchema.safeParse(
      aiResult.output,
    );
    if (!parsed.success) {
      return {
        ...base,
        outcome: 'INVALID_OUTPUT',
        error: `INVALID_OUTPUT: ${parsed.error.message}`.slice(0, 2000),
      };
    }

    const output = parsed.data;
    if (output.pageSnapshots?.length) {
      base.pageSnapshots = output.pageSnapshots.slice(0, 4);
    }
    if (output.outcome === 'PROVIDER_FAILURE') {
      return {
        ...base,
        outcome: 'PROVIDER_FAILURE',
        emailsFound: output.emails.length,
        error: (output.summary ?? 'Mastra PROVIDER_FAILURE').slice(0, 2000),
      };
    }

    base.emailsFound = output.emails.length;

    for (const item of output.emails) {
      const persist = await this.persistEmail({
        influencerId: params.influencerId,
        agencyId: params.agencyId,
        agencyDomain: params.domain,
        item,
      });
      if (persist === 'created') base.emailsPersistedCreated += 1;
      else if (persist === 'updated') base.emailsPersistedUpdated += 1;
      else if (persist === 'failed') base.emailsPersistFailed += 1;
      else base.emailsSkipped += 1;
    }

    const persisted = base.emailsPersistedCreated + base.emailsPersistedUpdated;
    if (
      base.emailsPersistFailed > 0 &&
      persisted === 0 &&
      base.emailsFound === 0
    ) {
      base.outcome = 'PROVIDER_FAILURE';
      base.error = `PERSIST_FAILED: ${base.emailsPersistFailed} email(s) failed`;
    } else if (base.emailsPersistFailed > 0) {
      // Aggregate marks PARTIAL when some agencies/emails fail but others succeed.
      base.outcome =
        base.emailsFound > 0 || persisted > 0 ? 'RESULTS_FOUND' : 'NO_MATCHES';
      base.error = `PARTIAL_PERSIST: ${base.emailsPersistFailed} email(s) failed`;
    } else if (base.emailsFound > 0 || persisted > 0) {
      base.outcome = 'RESULTS_FOUND';
    } else {
      base.outcome = 'NO_MATCHES';
    }

    return base;
  }

  /**
   * Pass-through Mastra fields; never invent sourceKind or VERIFIED.
   * Persistence service re-checks InfluencerAgency eligibility (2C.4.3.1).
   */
  private async persistEmail(params: {
    influencerId: string;
    agencyId: string;
    agencyDomain: string;
    item: AgencyContactFoundEmail;
  }): Promise<'created' | 'updated' | 'skipped' | 'failed'> {
    const { item } = params;
    // Contract requires agency_web; refuse inventing a different kind.
    if (item.sourceKind !== 'agency_web') {
      this.logger.warn(
        JSON.stringify({
          event: 'agency_contact_email_skipped_bad_source_kind',
          agencyId: params.agencyId,
          email: item.email,
          sourceKind: item.sourceKind,
        }),
      );
      return 'skipped';
    }

    try {
      const upsert = await this.agencyContacts.upsertFromDiscovery({
        influencerId: params.influencerId,
        agencyId: params.agencyId,
        agencyDomain: params.agencyDomain,
        email: item.email,
        sourceUrl: item.sourceUrl,
        evidenceSnippet: item.evidenceSnippet ?? item.email,
        sourceKind: item.sourceKind,
        ...(typeof item.isGeneric === 'boolean'
          ? { isGeneric: item.isGeneric }
          : {}),
        ...(item.commercialRelevance
          ? {
              commercialRelevance: this.mapCommercialRelevance(
                item.commercialRelevance,
              ),
            }
          : {}),
        ...(item.outreachRole ? { outreachRole: item.outreachRole } : {}),
      });
      if (upsert.skipped) return 'skipped';
      if (upsert.created) return 'created';
      if (upsert.updated) return 'updated';
      return 'skipped';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          event: 'agency_contact_email_persist_failed',
          agencyId: params.agencyId,
          email: item.email,
          errorMessage: message.slice(0, 500),
        }),
      );
      return 'failed';
    }
  }

  private mapCommercialRelevance(
    value: AgencyContactFoundEmail['commercialRelevance'],
  ): CommercialRelevance | undefined {
    switch (value) {
      case 'HIGH':
        return CommercialRelevance.HIGH;
      case 'NEUTRAL':
        return CommercialRelevance.NEUTRAL;
      case 'LOW':
        return CommercialRelevance.LOW;
      case 'UNKNOWN':
        return CommercialRelevance.UNKNOWN;
      default:
        return undefined;
    }
  }

  private aggregate(
    agencies: Track2CEmailsPassAgencyResult[],
  ): Track2CEmailsPassMetadata {
    const investigated = agencies.filter(
      (a) =>
        a.outcome !== 'SKIPPED_INELIGIBLE' &&
        a.outcome !== 'SKIPPED_NO_WEBSITE',
    );
    const failed = investigated.filter((a) =>
      [
        'PROVIDER_FAILURE',
        'INVALID_OUTPUT',
        'PUBLISH_FAILED',
        'WAIT_FAILED',
      ].includes(a.outcome),
    );
    const withResults = investigated.filter(
      (a) => a.outcome === 'RESULTS_FOUND',
    );
    const succeeded = investigated.filter(
      (a) => a.outcome === 'RESULTS_FOUND' || a.outcome === 'NO_MATCHES',
    );

    const emailsFound = agencies.reduce((n, a) => n + a.emailsFound, 0);
    const emailsPersistedCreated = agencies.reduce(
      (n, a) => n + a.emailsPersistedCreated,
      0,
    );
    const emailsPersistedUpdated = agencies.reduce(
      (n, a) => n + a.emailsPersistedUpdated,
      0,
    );
    const emailsSkipped = agencies.reduce((n, a) => n + a.emailsSkipped, 0);
    const emailsPersistFailed = agencies.reduce(
      (n, a) => n + a.emailsPersistFailed,
      0,
    );

    let outcome: Track2CEmailsPassMetadata['outcome'];
    if (investigated.length === 0) {
      outcome = 'SKIPPED_NO_ELIGIBLE';
    } else if (emailsPersistFailed > 0 && succeeded.length > 0) {
      outcome = 'PARTIAL';
    } else if (failed.length === investigated.length) {
      outcome = 'PROVIDER_FAILURE';
    } else if (failed.length > 0 && succeeded.length > 0) {
      outcome = 'PARTIAL';
    } else if (
      withResults.length > 0 ||
      emailsPersistedCreated + emailsPersistedUpdated > 0
    ) {
      outcome = 'RESULTS_FOUND';
    } else {
      outcome = 'NO_MATCHES';
    }

    const firstError =
      agencies.find((a) => a.error)?.error ??
      (outcome === 'PROVIDER_FAILURE'
        ? 'All agency email investigations failed'
        : null);

    return {
      executed: true,
      outcome,
      agenciesInvestigated: investigated.length,
      agenciesSucceeded: succeeded.length,
      agenciesFailed: failed.length,
      emailsFound,
      emailsPersistedCreated,
      emailsPersistedUpdated,
      emailsSkipped,
      emailsPersistFailed,
      error: firstError,
      agencies,
    };
  }
}
