import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiService } from '../../ai/ai.service';
import {
  DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS,
  DEFAULT_TAVILY_LEAD_QUERIES,
} from '../../ai/prompts/generate-lead-discovery.prompt';
import { BrightDataClient } from '../clients/brightdata.client';
import type {
  LeadFindContext,
  LeadSourceOption,
  LeadSourceProvider,
  RawLeadContact,
} from '../interfaces/lead-source-provider.interface';
import {
  EMAIL_CONTACT_DATASET_IDS,
  LINKEDIN_PEOPLE_SCRAPER_IDS,
  filterEmailContactCatalog,
} from '../utils/brightdata-catalog.util';

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

  async findContacts(context: LeadFindContext): Promise<RawLeadContact[]> {
    const allowlist = await this.resolveScraperAllowlist();
    if (allowlist.length === 0) {
      this.logger.warn(
        'No collectable Bright Data scrapers available for autonomous lead discovery',
      );
      return [];
    }

    const instructions =
      context.promptInstructions?.trim() || DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS;

    let tavilyQueries = DEFAULT_TAVILY_LEAD_QUERIES(context.brandName);
    let scraperIds = [allowlist[0]!.id];

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
      if (plan.tavilyQueries.length > 0) {
        tavilyQueries = plan.tavilyQueries.slice(0, 6);
      }
    } catch (error) {
      this.logger.warn(
        `LLM lead plan failed; using default playbook: ${String(error)}`,
      );
    }

    const profileUrls = await this.searchPeopleProfileUrls(tavilyQueries);
    if (profileUrls.length === 0) {
      this.logger.warn(
        `No LinkedIn people URLs found via Tavily for ${context.brandName}`,
      );
      return [];
    }

    const contacts: RawLeadContact[] = [];
    const inputs = profileUrls.slice(0, Math.max(context.limit, 1)).map((url) => ({
      url,
    }));

    for (const scraperId of scraperIds) {
      try {
        const records = await this.client.triggerAndCollect(scraperId, inputs);
        for (const record of records) {
          const mapped = this.mapRecord(record, scraperId);
          if (mapped) {
            contacts.push(mapped);
          }
        }
      } catch (error) {
        this.logger.warn(
          `Autonomous Bright Data scraper ${scraperId} failed: ${String(error)}`,
        );
      }
    }

    return contacts;
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

    // Prefer known IDs if somehow catalog empty but keys exist
    return [
      ...[...EMAIL_CONTACT_DATASET_IDS],
      ...[...LINKEDIN_PEOPLE_SCRAPER_IDS],
    ].map((id) => ({ id, name: id }));
  }

  private async searchPeopleProfileUrls(queries: string[]): Promise<string[]> {
    const tavilyKey = this.configService.get<string>('TAVILY_API_KEY')?.trim();
    if (!tavilyKey) {
      this.logger.warn('TAVILY_API_KEY missing for autonomous lead discovery');
      return [];
    }

    const urls = new Set<string>();
    for (const query of queries.slice(0, 6)) {
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            max_results: 5,
          }),
        });
        if (!response.ok) {
          continue;
        }
        const payload = (await response.json()) as {
          results?: Array<{ url?: string }>;
        };
        for (const result of payload.results ?? []) {
          const normalized = this.normalizePeopleLinkedInUrl(result.url);
          if (normalized) {
            urls.add(normalized);
          }
        }
      } catch {
        // continue
      }
    }
    return [...urls];
  }

  private normalizePeopleLinkedInUrl(url?: string): string | null {
    if (!url) {
      return null;
    }
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes('linkedin.com')) {
        return null;
      }
      const match = parsed.pathname.match(/\/in\/([^/]+)/i);
      if (!match?.[1]) {
        return null;
      }
      return `https://www.linkedin.com/in/${match[1]}`;
    } catch {
      return null;
    }
  }

  private mapRecord(
    record: BrightDataRecord,
    optionId: string,
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

    if (!email || !email.includes('@')) {
      return null;
    }

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

    return {
      contactName,
      title: title || undefined,
      email: email.toLowerCase(),
      profileUrl: profileUrl || undefined,
      fitReason: title
        ? `Autonomous lead discovery (${title})`
        : 'Autonomous lead discovery',
      sourceOptionId: optionId,
      source: AI_BRIGHTDATA_PROVIDER_ID,
      metadata: { rawKeys: Object.keys(record).slice(0, 20) },
    };
  }
}
