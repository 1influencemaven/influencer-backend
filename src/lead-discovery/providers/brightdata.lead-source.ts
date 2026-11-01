import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_LEAD_PRIORITY_ROLES } from '../../ai/prompts/generate-lead-discovery.prompt';
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
  classifyBrightDataOption,
  filterEmailContactCatalog,
} from '../utils/brightdata-catalog.util';
import { buildPeopleSearchTrace } from '../utils/lead-discovery-outcome.util';

type BrightDataRecord = Record<string, unknown>;

@Injectable()
export class BrightDataLeadSource implements LeadSourceProvider {
  readonly id = 'brightdata';
  private readonly logger = new Logger(BrightDataLeadSource.name);

  constructor(
    private readonly client: BrightDataClient,
    private readonly configService: ConfigService,
    private readonly searchOrchestrator: LeadDiscoverySearchOrchestrator,
  ) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async listOptions(): Promise<LeadSourceOption[]> {
    const catalog = await this.client.listCollectableCatalog();
    const emailOnly = filterEmailContactCatalog(catalog);

    if (emailOnly.length > 0) {
      return emailOnly.map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
      }));
    }

    const fallbackId = this.configService
      .get<string>('BRIGHTDATA_DATASET_ID')
      ?.trim();
    if (fallbackId) {
      this.logger.warn(
        'No collectable email/people scrapers in Bright Data account; using BRIGHTDATA_DATASET_ID fallback',
      );
      return [
        {
          id: fallbackId,
          name: `Configured scraper (${fallbackId})`,
          kind: 'scraper',
        },
      ];
    }

    this.logger.warn(
      'No collectable LinkedIn contact/people scrapers on this Bright Data account. Enable Scrapers (not Marketplace datasets) in the control panel.',
    );
    return [];
  }

  async findContacts(context: LeadFindContext): Promise<LeadFindResult> {
    const options = await this.listOptions();
    const optionById = new Map(options.map((o) => [o.id, o]));
    const priorityRoles = [...DEFAULT_LEAD_PRIORITY_ROLES];
    const searchResult = await this.searchOrchestrator.discoverProfileUrls({
      brandName: context.brandName,
      website: context.website,
      domain: context.domain,
      limit: context.limit,
      priorityRoles,
    });
    const profileUrls = searchResult.profileUrls;
    // Company LinkedIn URL: website only (Tavily company lookup removed).
    const companyUrl = this.ensureHttps(context.website);
    const contacts: RawLeadContact[] = [];
    let scraperInvocations = 0;
    let scraperSuccesses = 0;
    let scraperFailures = 0;
    const scraperErrorCodes: string[] = [];

    for (const optionId of context.optionIds) {
      const option = optionById.get(optionId);
      const kind = classifyBrightDataOption(optionId, option?.name ?? optionId);

      const inputs = this.buildInputs(kind, {
        profileUrls,
        companyUrl,
        limit: context.limit,
      });

      if (inputs.length === 0) {
        this.logger.warn(
          `No valid inputs for Bright Data option ${optionId} (kind=${kind})`,
        );
        continue;
      }

      scraperInvocations += 1;
      try {
        const records = await this.client.triggerAndCollect(optionId, inputs);
        scraperSuccesses += 1;
        for (const record of records) {
          const mapped = this.mapRecord(record, optionId, searchResult.trace);
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
          `Bright Data option ${optionId} failed: ${String(error)}`,
        );
      }
    }

    const searchMetadata = this.buildSearchMetadata({
      priorityRoles,
      scraperIds: context.optionIds,
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
    searchResult: Awaited<
      ReturnType<LeadDiscoverySearchOrchestrator['discoverProfileUrls']>
    >;
    scraperInvocations: number;
    scraperSuccesses: number;
    scraperFailures: number;
    scraperErrorCodes: string[];
  }): LeadSearchMetadata {
    const trace = args.searchResult.trace;
    return {
      strategy: 'manual',
      tracks: ['2B'],
      priorityRoles: args.priorityRoles,
      scraperIds: args.scraperIds,
      plannedQueriesCount: args.searchResult.plannedQueries.length,
      validatedQueriesCount: args.searchResult.executedQueries.length,
      queries: args.searchResult.executedQueries,
      fallbackUsed: false,
      fallbackReason: resolveLeadFallbackReason(false),
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

  private buildInputs(
    kind: ReturnType<typeof classifyBrightDataOption>,
    args: {
      profileUrls: string[];
      companyUrl: string;
      limit: number;
    },
  ): Record<string, unknown>[] {
    if (kind === 'company') {
      if (!/linkedin\.com\/company\//i.test(args.companyUrl)) {
        return [];
      }
      return [{ url: args.companyUrl }];
    }

    return args.profileUrls.slice(0, Math.max(args.limit, 1)).map((url) => ({
      url,
    }));
  }

  private ensureHttps(website: string): string {
    return /^https?:\/\//i.test(website) ? website : `https://${website}`;
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
        ? `Contact found via Bright Data (${title})`
        : 'Contact found via Bright Data',
      sourceOptionId: optionId,
      source: 'brightdata',
      metadata: {
        rawKeys: Object.keys(record).slice(0, 20),
        searchRunId: searchTrace.searchRunId,
        searchFallbackActivated: searchTrace.fallbackActivated,
      },
    };
  }
}
