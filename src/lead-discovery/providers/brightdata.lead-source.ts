import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrightDataClient } from '../clients/brightdata.client';
import type {
  LeadFindContext,
  LeadSourceOption,
  LeadSourceProvider,
  RawLeadContact,
} from '../interfaces/lead-source-provider.interface';
import {
  classifyBrightDataOption,
  filterEmailContactCatalog,
} from '../utils/brightdata-catalog.util';

type BrightDataRecord = Record<string, unknown>;

const ROLE_QUERIES = [
  'CEO',
  'Founder',
  'CMO',
  'Marketing Manager',
  'Brand Manager',
  'Influencer Marketing',
  'Partnerships',
];

@Injectable()
export class BrightDataLeadSource implements LeadSourceProvider {
  readonly id = 'brightdata';
  private readonly logger = new Logger(BrightDataLeadSource.name);

  constructor(
    private readonly client: BrightDataClient,
    private readonly configService: ConfigService,
  ) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async listOptions(): Promise<LeadSourceOption[]> {
    // Only scrapers (/datasets/v3/scrapers). Marketplace /datasets/list entries
    // often fail trigger with "This dataset does not support collection".
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

  async findContacts(context: LeadFindContext): Promise<RawLeadContact[]> {
    const options = await this.listOptions();
    const optionById = new Map(options.map((o) => [o.id, o]));
    const profileUrls = await this.resolvePeopleProfileUrls(context);
    const companyUrl = await this.resolveCompanyUrl(context);
    const contacts: RawLeadContact[] = [];

    for (const optionId of context.optionIds) {
      const option = optionById.get(optionId);
      const kind = classifyBrightDataOption(
        optionId,
        option?.name ?? optionId,
      );

      try {
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

        const records = await this.client.triggerAndCollect(optionId, inputs);
        for (const record of records) {
          const mapped = this.mapRecord(record, optionId);
          if (mapped) {
            contacts.push(mapped);
          }
        }
      } catch (error) {
        this.logger.warn(
          `Bright Data option ${optionId} failed: ${String(error)}`,
        );
      }
    }

    return contacts;
  }

  /**
   * LinkedIn people/contact scrapers reject `keyword` and company URLs.
   * They expect only `{ url: "https://www.linkedin.com/in/..." }`.
   */
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

    // people + contact (+ unknown treated as people/contact URL scrapers)
    return args.profileUrls.slice(0, Math.max(args.limit, 1)).map((url) => ({
      url,
    }));
  }

  private async resolvePeopleProfileUrls(
    context: LeadFindContext,
  ): Promise<string[]> {
    const tavilyKey = this.configService.get<string>('TAVILY_API_KEY')?.trim();
    if (!tavilyKey) {
      this.logger.warn(
        'TAVILY_API_KEY missing: cannot discover LinkedIn people URLs for email scrapers',
      );
      return [];
    }

    const urls = new Set<string>();
    const queries = ROLE_QUERIES.map(
      (role) => `${context.brandName} ${role} LinkedIn`,
    ).slice(0, 5);

    for (const query of queries) {
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
        // continue other queries
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
      if (!/linkedin\.com$/i.test(parsed.hostname.replace(/^www\./, ''))) {
        // hostname may be www.linkedin.com
      }
      if (!parsed.hostname.includes('linkedin.com')) {
        return null;
      }
      if (!/\/in\//i.test(parsed.pathname)) {
        return null;
      }
      // Strip query/hash; keep /in/slug
      const match = parsed.pathname.match(/\/in\/([^/]+)/i);
      if (!match?.[1]) {
        return null;
      }
      return `https://www.linkedin.com/in/${match[1]}`;
    } catch {
      return null;
    }
  }

  private async resolveCompanyUrl(context: LeadFindContext): Promise<string> {
    const tavilyKey = this.configService.get<string>('TAVILY_API_KEY')?.trim();
    if (!tavilyKey) {
      return this.ensureHttps(context.website);
    }

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: `${context.brandName} LinkedIn company`,
          max_results: 5,
        }),
      });

      if (!response.ok) {
        return this.ensureHttps(context.website);
      }

      const payload = (await response.json()) as {
        results?: Array<{ url?: string }>;
      };
      const linkedIn = payload.results?.find((result) =>
        String(result.url ?? '').includes('linkedin.com/company'),
      )?.url;

      return linkedIn ? linkedIn.split('?')[0]! : this.ensureHttps(context.website);
    } catch {
      return this.ensureHttps(context.website);
    }
  }

  private ensureHttps(website: string): string {
    return /^https?:\/\//i.test(website) ? website : `https://${website}`;
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
        ? `Contact found via Bright Data (${title})`
        : 'Contact found via Bright Data',
      sourceOptionId: optionId,
      source: 'brightdata',
      metadata: { rawKeys: Object.keys(record).slice(0, 20) },
    };
  }
}
