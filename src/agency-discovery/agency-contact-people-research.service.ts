import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AGENCY_CONTACT_DEFAULT_PRIORITY_ROLES,
  contactResearchFindAgencyPeopleOutputSchema,
  type AgencyContactPerson,
  type ContactResearchPageSnapshot,
} from '@influence-maven/ai-contracts';

import { AiExecutionPublisherService } from '../ai-execution/ai-execution-publisher.service';
import { AiExecutionWaitError } from '../ai-execution/ai-execution-result-wait.errors';
import { AiExecutionResultWaitService } from '../ai-execution/ai-execution-result-wait.service';
import { AgencyContactKind } from '../generated/prisma/enums';
import { canAttributeEmailToPerson } from '../lead-discovery/utils/contact-email-attribution.util';
import { classifyCommercialRelevance } from '../lead-discovery/utils/commercial-relevance.util';
import { PrismaService } from '../prisma/prisma.service';
import type { Track2CEmailsPassMetadata } from './agency-contact-emails-research.service';
import { AgencyContactPersistenceService } from './agency-contact-persistence.service';
import { mapPool } from '../brand-discovery/utils/map-pool.util';
import {
  AGENCY_CONTACT_ELIGIBLE_RELEVANCE,
  AGENCY_RESEARCH_CONCURRENCY,
  isAgencyEligibleForContactResearch,
  rankAgencyAssociations,
} from './utils/agency-contact-eligibility.util';

/** Per-agency Mastra wait (aligned with brand 2B). */
export const AGENCY_CONTACT_PEOPLE_TIMEOUT_MS = 300_000;

export const AGENCY_CONTACT_PEOPLE_MAX_AGENCIES_PER_RUN = 5;

export type Track2CPeoplePassAgencyResult = {
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
  peopleFound: number;
  peopleWithAttributedEmail: number;
  contactsPersistedCreated: number;
  contactsPersistedUpdated: number;
  contactsSkipped: number;
  contactsPersistFailed: number;
  snapshotsReceived?: number;
  peePagesReused?: number;
  error?: string | null;
};

export type Track2CPeoplePassMetadata = {
  executed: boolean;
  peoplePassPolicy: 'ALWAYS';
  outcome?:
    | 'RESULTS_FOUND'
    | 'NO_MATCHES'
    | 'PROVIDER_FAILURE'
    | 'PARTIAL'
    | 'SKIPPED_NO_ELIGIBLE';
  agenciesInvestigated?: number;
  agenciesSucceeded?: number;
  agenciesFailed?: number;
  peopleFound?: number;
  contactsPersistedCreated?: number;
  contactsPersistedUpdated?: number;
  contactsSkipped?: number;
  contactsPersistFailed?: number;
  error?: string | null;
  agencies?: Track2CPeoplePassAgencyResult[];
};

export type AgencyContactPeopleResearchInput = {
  runId: string;
  influencerId: string;
  userId?: string;
  niche?: string | null;
  niches?: string[];
  country?: string | null;
  markets?: string[];
  /** Same-run emails-pass metadata (snapshots bridge); never gates execution. */
  emailsPass?: Track2CEmailsPassMetadata;
};

/**
 * Map agency_web → brand_web for RF-01 person attribution rules without
 * modifying the shared util surface (same evidence requirements).
 */
function canAttributeAgencyPersonEmail(params: {
  email: string;
  personName: string;
  sourceKind: 'linkedin' | 'agency_web' | 'ocr';
  evidenceSnippet?: string | null;
}): boolean {
  const mapped =
    params.sourceKind === 'agency_web'
      ? 'brand_web'
      : params.sourceKind === 'ocr'
        ? 'ocr'
        : 'linkedin';
  return canAttributeEmailToPerson({
    email: params.email,
    personName: params.personName,
    sourceKind: mapped,
    evidenceSnippet: params.evidenceSnippet,
  });
}

/**
 * 2C.4.6 — Nest publish/wait/persist for FIND_AGENCY_PEOPLE (ALWAYS).
 * Soft-isolated from emails-pass and from brand 2A/2B.
 */
@Injectable()
export class AgencyContactPeopleResearchService {
  private readonly logger = new Logger(AgencyContactPeopleResearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: AiExecutionPublisherService,
    private readonly resultWait: AiExecutionResultWaitService,
    private readonly agencyContacts: AgencyContactPersistenceService,
    private readonly configService: ConfigService,
  ) {}

  async researchEligibleAgencies(
    input: AgencyContactPeopleResearchInput,
  ): Promise<Track2CPeoplePassMetadata> {
    const maxAgencies =
      this.configService.get<number>('AI_AGENCY_PEOPLE_MAX_AGENCIES') ??
      AGENCY_CONTACT_PEOPLE_MAX_AGENCIES_PER_RUN;
    const maxSerpQueries =
      this.configService.get<number>('AI_PEOPLE_MAX_SERP_QUERIES') ?? 4;
    const maxProfiles =
      this.configService.get<number>('AI_PEOPLE_MAX_PROFILES') ?? 5;
    const maxAgencyPages =
      this.configService.get<number>('AI_PEOPLE_MAX_BRAND_PAGES') ?? 6;
    const ocrEnabled =
      this.configService.get<boolean>('CONTACT_OCR_ENABLED') === true;
    const userId = input.userId ?? 'system:agency-contact-people';

    const snapshotByAgency = new Map<string, ContactResearchPageSnapshot[]>();
    for (const row of input.emailsPass?.agencies ?? []) {
      if (row.pageSnapshots?.length) {
        snapshotByAgency.set(row.agencyId, row.pageSnapshots.slice(0, 4));
      }
    }

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
        peoplePassPolicy: 'ALWAYS',
        outcome: 'SKIPPED_NO_ELIGIBLE',
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

    // Agencies are independent: research up to AGENCY_RESEARCH_CONCURRENCY at once
    // (order of results is preserved for metadata).
    const agencyResults = await mapPool(
      associations,
      AGENCY_RESEARCH_CONCURRENCY,
      async (row): Promise<Track2CPeoplePassAgencyResult> => {
        const agency = row.agency;
        if (!isAgencyEligibleForContactResearch(row.relevanceStatus)) {
          return {
            agencyId: agency.id,
            domain: agency.domain,
            relevanceStatus: row.relevanceStatus,
            outcome: 'SKIPPED_INELIGIBLE',
            peopleFound: 0,
            peopleWithAttributedEmail: 0,
            contactsPersistedCreated: 0,
            contactsPersistedUpdated: 0,
            contactsSkipped: 0,
            contactsPersistFailed: 0,
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
            peopleFound: 0,
            peopleWithAttributedEmail: 0,
            contactsPersistedCreated: 0,
            contactsPersistedUpdated: 0,
            contactsSkipped: 0,
            contactsPersistFailed: 0,
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
          niche: input.niche,
          niches: input.niches,
          country: input.country,
          markets: input.markets,
          maxSerpQueries,
          maxProfiles,
          maxAgencyPages,
          ocrEnabled,
          pageSnapshots: snapshotByAgency.get(agency.id),
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
    niche?: string | null;
    niches?: string[];
    country?: string | null;
    markets?: string[];
    maxSerpQueries: number;
    maxProfiles: number;
    maxAgencyPages: number;
    ocrEnabled: boolean;
    pageSnapshots?: ContactResearchPageSnapshot[];
  }): Promise<Track2CPeoplePassAgencyResult> {
    const base: Track2CPeoplePassAgencyResult = {
      agencyId: params.agencyId,
      domain: params.domain,
      relevanceStatus: params.relevanceStatus,
      outcome: 'NO_MATCHES',
      peopleFound: 0,
      peopleWithAttributedEmail: 0,
      contactsPersistedCreated: 0,
      contactsPersistedUpdated: 0,
      contactsSkipped: 0,
      contactsPersistFailed: 0,
      snapshotsReceived: params.pageSnapshots?.length ?? 0,
    };

    let executionId: string;
    try {
      const published =
        await this.publisher.publishContactResearchFindAgencyPeople({
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
          priorityRoles: [...AGENCY_CONTACT_DEFAULT_PRIORITY_ROLES],
          maxSerpQueries: params.maxSerpQueries,
          maxProfilesToScrape: params.maxProfiles,
          maxAgencyPages: params.maxAgencyPages,
          ocrEnabled: params.ocrEnabled,
          ...(params.pageSnapshots?.length
            ? { pageSnapshots: params.pageSnapshots }
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
        event: 'agency_contact_people_published',
        runId: params.runId,
        agencyId: params.agencyId,
        executionId,
        snapshotsForwarded: params.pageSnapshots?.length ?? 0,
      }),
    );

    let aiResult;
    try {
      aiResult = await this.resultWait.waitForAiExecutionResult(
        executionId,
        AGENCY_CONTACT_PEOPLE_TIMEOUT_MS,
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

    if (aiResult.output.operation !== 'FIND_AGENCY_PEOPLE') {
      return {
        ...base,
        outcome: 'INVALID_OUTPUT',
        error: `Unexpected CONTACT_RESEARCH operation=${aiResult.output.operation}`,
      };
    }

    const parsed = contactResearchFindAgencyPeopleOutputSchema.safeParse(
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
    base.peePagesReused = output.trace?.peeReuse?.peePagesReused;
    if (output.outcome === 'PROVIDER_FAILURE') {
      return {
        ...base,
        outcome: 'PROVIDER_FAILURE',
        peopleFound: output.people.length,
        error: (output.summary ?? 'Mastra PROVIDER_FAILURE').slice(0, 2000),
      };
    }

    base.peopleFound = output.people.length;

    for (const person of output.people) {
      const persistStats = await this.persistPersonContacts({
        influencerId: params.influencerId,
        agencyId: params.agencyId,
        agencyDomain: params.domain,
        person,
      });
      base.peopleWithAttributedEmail += persistStats.attributedEmails;
      base.contactsPersistedCreated += persistStats.created;
      base.contactsPersistedUpdated += persistStats.updated;
      base.contactsSkipped += persistStats.skipped;
      base.contactsPersistFailed += persistStats.failed;
    }

    const persisted =
      base.contactsPersistedCreated + base.contactsPersistedUpdated;
    if (
      base.contactsPersistFailed > 0 &&
      persisted === 0 &&
      base.peopleFound === 0
    ) {
      base.outcome = 'PROVIDER_FAILURE';
      base.error = `PERSIST_FAILED: ${base.contactsPersistFailed} contact(s) failed`;
    } else if (base.contactsPersistFailed > 0) {
      base.outcome =
        base.peopleFound > 0 || persisted > 0 ? 'RESULTS_FOUND' : 'NO_MATCHES';
      base.error = `PARTIAL_PERSIST: ${base.contactsPersistFailed} contact(s) failed`;
    } else if (base.peopleFound > 0 || persisted > 0) {
      base.outcome = 'RESULTS_FOUND';
    } else {
      base.outcome = 'NO_MATCHES';
    }

    return base;
  }

  /**
   * Persist only person↔email pairs with RF-01 evidence.
   * AgencyContact requires email — people without attributed email are skipped.
   */
  private async persistPersonContacts(params: {
    influencerId: string;
    agencyId: string;
    agencyDomain: string;
    person: AgencyContactPerson;
  }): Promise<{
    attributedEmails: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  }> {
    const stats = {
      attributedEmails: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    const displayName = params.person.name?.trim();
    if (!displayName) {
      stats.skipped += 1;
      return stats;
    }

    const attributed = params.person.emails.filter((email) =>
      canAttributeAgencyPersonEmail({
        email: email.email,
        personName: displayName,
        sourceKind: email.sourceKind,
        evidenceSnippet: email.evidenceSnippet,
      }),
    );
    stats.attributedEmails = attributed.length;

    if (attributed.length === 0) {
      // Person found but no demonstrable email attribution — do not invent PERSON row.
      return stats;
    }

    for (const email of attributed) {
      try {
        const upsert = await this.agencyContacts.upsertFromDiscovery({
          influencerId: params.influencerId,
          agencyId: params.agencyId,
          agencyDomain: params.agencyDomain,
          email: email.email,
          sourceUrl: email.sourceUrl,
          evidenceSnippet: email.evidenceSnippet ?? email.email,
          sourceKind: email.sourceKind,
          contactKind: AgencyContactKind.PERSON,
          displayName,
          title: params.person.title ?? null,
          isGeneric: false,
          commercialRelevance: classifyCommercialRelevance(email.email),
          outreachRole: params.person.title?.trim() || undefined,
        });
        if (upsert.skipped) stats.skipped += 1;
        else if (upsert.created) stats.created += 1;
        else if (upsert.updated) stats.updated += 1;
        else stats.skipped += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          JSON.stringify({
            event: 'agency_contact_person_persist_failed',
            agencyId: params.agencyId,
            email: email.email,
            errorMessage: message.slice(0, 500),
          }),
        );
        stats.failed += 1;
      }
    }

    return stats;
  }

  private aggregate(
    agencies: Track2CPeoplePassAgencyResult[],
  ): Track2CPeoplePassMetadata {
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

    const peopleFound = agencies.reduce((n, a) => n + a.peopleFound, 0);
    const contactsPersistedCreated = agencies.reduce(
      (n, a) => n + a.contactsPersistedCreated,
      0,
    );
    const contactsPersistedUpdated = agencies.reduce(
      (n, a) => n + a.contactsPersistedUpdated,
      0,
    );
    const contactsSkipped = agencies.reduce((n, a) => n + a.contactsSkipped, 0);
    const contactsPersistFailed = agencies.reduce(
      (n, a) => n + a.contactsPersistFailed,
      0,
    );

    let outcome: Track2CPeoplePassMetadata['outcome'];
    if (investigated.length === 0) {
      outcome = 'SKIPPED_NO_ELIGIBLE';
    } else if (contactsPersistFailed > 0 && succeeded.length > 0) {
      outcome = 'PARTIAL';
    } else if (failed.length === investigated.length) {
      outcome = 'PROVIDER_FAILURE';
    } else if (failed.length > 0 && succeeded.length > 0) {
      outcome = 'PARTIAL';
    } else if (
      withResults.length > 0 ||
      contactsPersistedCreated + contactsPersistedUpdated > 0
    ) {
      outcome = 'RESULTS_FOUND';
    } else {
      outcome = 'NO_MATCHES';
    }

    const firstError =
      agencies.find((a) => a.error)?.error ??
      (outcome === 'PROVIDER_FAILURE'
        ? 'All agency people investigations failed'
        : null);

    return {
      executed: true,
      peoplePassPolicy: 'ALWAYS',
      outcome,
      agenciesInvestigated: investigated.length,
      agenciesSucceeded: succeeded.length,
      agenciesFailed: failed.length,
      peopleFound,
      contactsPersistedCreated,
      contactsPersistedUpdated,
      contactsSkipped,
      contactsPersistFailed,
      error: firstError,
      agencies,
    };
  }
}
