import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiService } from '../../ai/ai.service';
import type {
  BrandSourceContext,
  BrandSourceProvider,
  RawBrandCandidate,
} from '../interfaces/brand-source-provider.interface';
import {
  ensureWebsiteUrl,
  normalizeDomain,
} from '../utils/brand-domain.util';

type BrightDataRecord = Record<string, unknown>;

@Injectable()
export class BrightDataBrandSource implements BrandSourceProvider {
  readonly name = 'brightdata';
  private readonly logger = new Logger(BrightDataBrandSource.name);
  private readonly apiKey: string;
  private readonly datasetId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiService: AiService,
  ) {
    this.apiKey = this.configService.getOrThrow<string>('BRIGHTDATA_API_KEY');
    this.datasetId = this.configService.getOrThrow<string>(
      'BRIGHTDATA_DATASET_ID',
    );
  }

  async discover(context: BrandSourceContext): Promise<RawBrandCandidate[]> {
    const records = await this.fetchCompanyRecords(context);
    const seedBrands = records
      .map((record) => this.mapRecord(record))
      .filter((brand): brand is NonNullable<typeof brand> => brand !== null)
      .slice(0, context.limit * 2);

    if (seedBrands.length === 0) {
      this.logger.warn('BrightData returned no mappable company records');
      return [];
    }

    const scored = await this.aiService.scoreBrandCandidates({
      influencerName: context.influencerName,
      niche: context.influencerNiche,
      ibp: context.ibp,
      limit: context.limit,
      searchHits: seedBrands.map((brand) => ({
        title: brand.name,
        url: brand.website,
        content: [brand.sector, brand.market, brand.brandSize]
          .filter(Boolean)
          .join(' · '),
      })),
      seedBrands,
      instructions: context.promptInstructions,
    });

    return scored.brands.map((brand) => {
      const website = ensureWebsiteUrl(brand.website);
      return {
        name: brand.name,
        website,
        domain: normalizeDomain(website),
        sector: brand.sector,
        market: brand.market,
        brandSize: brand.brandSize,
        score: brand.score,
        fitReason: brand.fitReason,
        source: this.name,
        evidenceUrls: brand.evidenceUrls?.length
          ? brand.evidenceUrls
          : [website],
      };
    });
  }

  private async fetchCompanyRecords(
    context: BrandSourceContext,
  ): Promise<BrightDataRecord[]> {
    const keyword = [
      ...context.ibp.targetSectors.slice(0, 2),
      ...context.ibp.markets.slice(0, 1),
    ].join(' ');

    const response = await fetch(
      `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${encodeURIComponent(this.datasetId)}&format=json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            keyword,
            country: context.ibp.markets[0] ?? undefined,
            limit: context.limit,
          },
        ]),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`BrightData trigger failed: ${response.status} ${body}`);
      throw new Error(`BrightData request failed with status ${response.status}`);
    }

    const payload: unknown = await response.json();

    if (Array.isArray(payload)) {
      return payload as BrightDataRecord[];
    }

    if (payload && typeof payload === 'object') {
      const asRecord = payload as Record<string, unknown>;
      if (Array.isArray(asRecord.data)) {
        return asRecord.data as BrightDataRecord[];
      }
      if (typeof asRecord.snapshot_id === 'string') {
        return this.pollSnapshot(asRecord.snapshot_id);
      }
    }

    this.logger.warn('Unexpected BrightData response shape; returning empty');
    return [];
  }

  private async pollSnapshot(snapshotId: string): Promise<BrightDataRecord[]> {
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const response = await fetch(
        `https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        },
      );

      if (response.status === 202) {
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `BrightData snapshot failed: ${response.status} ${body}`,
        );
      }

      const data: unknown = await response.json();
      return Array.isArray(data) ? (data as BrightDataRecord[]) : [];
    }

    throw new Error('BrightData snapshot polling timed out');
  }

  private mapRecord(record: BrightDataRecord): {
    name: string;
    website: string;
    sector?: string;
    market?: string;
    brandSize?: string;
    evidenceUrls?: string[];
  } | null {
    const name = String(
      record.name ?? record.company_name ?? record.title ?? '',
    ).trim();
    const website = String(
      record.website ?? record.url ?? record.domain ?? '',
    ).trim();

    if (!name || !website) {
      return null;
    }

    return {
      name,
      website: ensureWebsiteUrl(website),
      sector: record.industry
        ? String(record.industry)
        : record.sector
          ? String(record.sector)
          : undefined,
      market: record.country
        ? String(record.country)
        : record.location
          ? String(record.location)
          : undefined,
      brandSize: record.employees
        ? String(record.employees)
        : record.company_size
          ? String(record.company_size)
          : undefined,
      evidenceUrls: [
        ensureWebsiteUrl(website),
        record.linkedin_url ? String(record.linkedin_url) : '',
      ].filter(Boolean),
    };
  }
}
