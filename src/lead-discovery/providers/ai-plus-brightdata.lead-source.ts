import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiService } from '../../ai/ai.service';
import { DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS } from '../../ai/prompts/generate-lead-discovery.prompt';
import { BrightDataClient } from '../clients/brightdata.client';
import type {
  LeadFindContext,
  LeadFindResult,
  LeadSearchMetadata,
  LeadSourceOption,
  LeadSourceProvider,
  RawLeadContact,
} from '../interfaces/lead-source-provider.interface';
import { resolveLeadFallbackReason } from '../interfaces/lead-source-provider.interface';
import { LeadDiscoverySearchOrchestrator } from '../search/lead-discovery-search.orchestrator';
import {
  EMAIL_CONTACT_DATASET_IDS,
  LINKEDIN_PEOPLE_SCRAPER_IDS,
  filterEmailContactCatalog,
} from '../utils/brightdata-catalog.util';
import { buildPeopleSearchTrace } from '../utils/lead-discovery-outcome.util';

type BrightDataRecord = Record<string, unknown>;

export const AI_BRIGHTDATA_PROVIDER_ID = 'ai+brightdata';

@Injectable()
export class AiPlusBrightDataLeadSource implements LeadSourceProvider {
  readonly id = AI_BRIGHTDATA_PROVIDER_ID;
  private readonly logger = new Logger(AiPlusBrightDataLeadSource.name);

  constructor(
    private readonly client: BrightDataClient,
    private readonly configService: ConfigService,
    private readonly aiService: AiService,
    private readonly searchOrchestrator: LeadDiscoverySearchOrchestrator,
  ) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async listOptions(): Promise<LeadSourceOption[]> {
    return [
      {
        id: 'autonomous',
        name: 'Autonomous AI + Bright Data',
        kind: 'autonomous',
      },
    ];
  }

  async findContacts(context: LeadFindContext): Promise<LeadFindResult> {
    const allowlist = await this.resolveScraperAllowlist();
    if (allowlist.length === 0) {
      this.logger.warn(
        'No collectable Bright Data scrapers available for autonomous lead discovery',
      );
      return { contacts: [], searchMetadata: null };
    }

    this.logger.log(
      JSON.stringify({
        event: 'lead_scraper_allowlist',
        scrapers: allowlist.map((item) => ({
          scraperId: item.id,
          name: item.name,
        })),
      }),
    );

    const instructions =
      context.promptInstructions?.trim() || DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS;

    let priorityRoles: string[] = [];
    let scraperIds = [allowlist[0].id];
    let aiPlanFailed = false;

    try {
      const plan = await this.aiService.planLeadDiscovery({
        brandName: context.brandName,
        website: context.website,
        domain: context.domain,
        limit: context.limit,
        scraperAllowlist: allowlist,
        instructions,
      });
      const allowIds = new Set(allowlist.map((s) => s.id));
      const plannedScrapers = plan.scraperIds.filter((id) => allowIds.has(id));
      if (plannedScrapers.length > 0) {
        scraperIds = plannedScrapers;
      }
      if (plan.priorityRoles.length > 0) {
        priorityRoles = plan.priorityRoles.slice(0, 6);
      }
    } catch (error) {
      aiPlanFailed = true;
      this.logger.warn(
        `LLM lead plan failed; using default playbook: ${String(error)}`,
      );
    }

    const searchResult = await this.searchOrchestrator.discoverProfileUrls({
      brandName: context.brandName,
      website: context.website,
      domain: context.domain,
      limit: context.limit,
      priorityRoles,
    });

    const profileUrls = searchResult.profileUrls;
    let scraperInvocations = 0;
    let scraperSuccesses = 0;
    let scraperFailures = 0;
    const scraperErrorCodes: string[] = [];
    const contacts: RawLeadContact[] = [];

    if (profileUrls.length === 0) {
      this.logger.warn(
        `No LinkedIn people URLs found via Bright Data search for ${context.brandName}`,
      );
    } else {
      this.logger.log(
        JSON.stringify({
          event: 'lead_search_complete',
          brand: context.brandName,
          searchRunId: searchResult.trace.searchRunId,
          fallbackActivated: searchResult.trace.fallbackActivated,
          profileUrlCount: profileUrls.length,
          scraperIds,
        }),
      );

      const inputs = profileUrls
        .slice(0, Math.max(context.limit, 1))
        .map((url) => ({
          url,
        }));

      for (const scraperId of scraperIds) {
        scraperInvocations += 1;
        try {
          const records = await this.client.triggerAndCollect(scraperId, inputs);
          scraperSuccesses += 1;
          for (const record of records) {
            const mapped = this.mapRecord(
              record,
              scraperId,
              searchResult.trace,
            );
            if (mapped) {
              contacts.push(mapped);
            }
          }
        } catch (error) {
          scraperFailures += 1;
          const code =
            error instanceof Error && error.name
              ? error.name.slice(0, 64)
              : 'scraper_error';
          scraperErrorCodes.push(code);
          this.logger.warn(
            `Autonomous Bright Data scraper ${scraperId} failed: ${String(error)}`,
          );
        }
      }
    }

    const searchMetadata = this.buildSearchMetadata({
      priorityRoles,
      scraperIds,
      aiPlanFailed,
      searchResult,
      scraperInvocations,
      scraperSuccesses,
      scraperFailures,
      scraperErrorCodes,
    });

    return { contacts, searchMetadata };
  }

  private buildSearchMetadata(args: {
    priorityRoles: string[];
    scraperIds: string[];
    aiPlanFailed: boolean;
    searchResult: Awaited<
      ReturnType<LeadDiscoverySearchOrchestrator['discoverProfileUrls']>
    >;
    scraperInvocations: number;
    scraperSuccesses: number;
    scraperFailures: number;
    scraperErrorCodes: string[];
  }): LeadSearchMetadata {
    const fallbackUsed = args.aiPlanFailed;
    const trace = args.searchResult.trace;
    return {
      strategy: 'llm',
      tracks: ['2B'],
      priorityRoles: args.priorityRoles,
      scraperIds: args.scraperIds,
      plannedQueriesCount: args.searchResult.plannedQueries.length,
      validatedQueriesCount: args.searchResult.executedQueries.length,
      queries: args.searchResult.executedQueries,
      fallbackUsed,
      fallbackReason: resolveLeadFallbackReason(args.aiPlanFailed),
      searchHitsCount: args.searchResult.searchHitsCount,
      peopleSearchTrace: buildPeopleSearchTrace({
        searchHitsReceived: args.searchResult.searchHitsCount,
        linkedinUrlValidated: trace.linkedinUrlValidated,
        scoredCandidates: trace.linkedinUrlValidated,
        qualifiedCandidates: trace.qualifiedCandidates,
        selectedProfileUrls: trace.selectedUrls,
        brightDataSearchRequests: trace.brightDataRequests,
        brightDataSearchFailures: trace.brightDataSearchFailures,
        tavilyFallbackRequests: 0,
        scraperInvocations: args.scraperInvocations,
        scraperSuccesses: args.scraperSuccesses,
        scraperFailures: args.scraperFailures,
        searchFailureCodes: trace.failures.map((f) => f.code),
        scraperErrorCodes: args.scraperErrorCodes,
        brightDataDiagnostics: trace.brightDataDiagnostics,
      }),
    };
  }

  private async resolveScraperAllowlist(): Promise<
    Array<{ id: string; name: string }>
  > {
    const catalog = await this.client.listCollectableCatalog();
    const filtered = filterEmailContactCatalog(catalog);
    if (filtered.length > 0) {
      return filtered.map((item) => ({ id: item.id, name: item.name }));
    }

    const fallbackId = this.configService
      .get<string>('BRIGHTDATA_DATASET_ID')
      ?.trim();
    if (fallbackId) {
      return [{ id: fallbackId, name: `Configured scraper (${fallbackId})` }];
    }

    return [
      ...[...EMAIL_CONTACT_DATASET_IDS],
      ...[...LINKEDIN_PEOPLE_SCRAPER_IDS],
    ].map((id) => ({ id, name: id }));
  }

  private mapRecord(
    record: BrightDataRecord,
    optionId: string,
    searchTrace: { searchRunId: string; fallbackActivated: boolean },
  ): RawLeadContact | null {
    const email = String(
      record.email ??
        record.business_email ??
        record.work_email ??
        record.emails ??
        '',
    )
      .split(',')[0]
      ?.trim();

    const contactName = String(
      record.name ??
        record.full_name ??
        [record.first_name, record.last_name].filter(Boolean).join(' ') ??
        '',
    ).trim();

    if (!contactName) {
      return null;
    }

    const title = String(
      record.title ?? record.job_title ?? record.position ?? '',
    ).trim();

    const profileUrl = String(
      record.linkedin ??
        record.linkedin_url ??
        record.profile_url ??
        record.url ??
        '',
    ).trim();

    const hasEmail = Boolean(email && email.includes('@'));
    const hasProfile = Boolean(profileUrl);

    if (!hasEmail && !hasProfile) {
      return null;
    }

    const company = record.current_company as
      | { name?: string; link?: string }
      | undefined;
    const companyNameRaw =
      company?.name ?? String(record.current_company_name ?? '').trim();
    const companyName = companyNameRaw || undefined;
    const companyLinkedInUrl = company?.link?.trim() || undefined;

    return {
      contactName,
      title: title || undefined,
      email: hasEmail ? email.toLowerCase() : undefined,
      profileUrl: hasProfile ? profileUrl : undefined,
      companyName,
      companyLinkedInUrl,
      fitReason: title
        ? `Autonomous lead discovery (${title})`
        : 'Autonomous lead discovery',
      sourceOptionId: optionId,
      source: AI_BRIGHTDATA_PROVIDER_ID,
      metadata: {
        rawKeys: Object.keys(record).slice(0, 20),
        searchRunId: searchTrace.searchRunId,
        searchFallbackActivated: searchTrace.fallbackActivated,
      },
    };
  }
}
