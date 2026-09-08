import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  SearchQuery,
  SearchResult,
  SearchResultItem,
} from '../interfaces/lead-search.interface';
import { domainFromUrl } from '../utils/linkedin-url.util';

const BASE_URL = 'https://api.brightdata.com';

@Injectable()
export class BrightDataSearchClient {
  private readonly logger = new Logger(BrightDataSearchClient.name);
  private readonly apiKey: string;
  private readonly zone: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      this.configService.get<string>('BRIGHTDATA_API_KEY')?.trim() ?? '';
    this.zone =
      this.configService
        .get<string>('BRIGHTDATA_UNLOCKER_ZONE')
        ?.trim() ||
      this.configService.get<string>('BRIGHTDATA_ZONE')?.trim() ||
      'mcp_unlocker';
    this.timeoutMs =
      this.configService.get<number>('BRIGHTDATA_SEARCH_TIMEOUT_MS') ?? 30000;
    this.maxRetries =
      this.configService.get<number>('BRIGHTDATA_SEARCH_MAX_RETRIES') ?? 2;
    this.retryBackoffMs =
      this.configService.get<number>('BRIGHTDATA_SEARCH_RETRY_BACKOFF_MS') ??
      1500;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /** Fetch raw HTML via Web Unlocker (same zone as Search). */
  async fetchRawHtml(url: string): Promise<{
    html: string;
    httpStatus: number;
    elapsedMs: number;
    emptyBody: boolean;
  }> {
    const start = Date.now();
    try {
      const response = await fetch(`${BASE_URL}/request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          zone: this.zone,
          url,
          format: 'raw',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const html = await response.text();
      return {
        html,
        httpStatus: response.status,
        elapsedMs: Date.now() - start,
        emptyBody: html.length === 0,
      };
    } catch (error) {
      return {
        html: '',
        httpStatus: 0,
        elapsedMs: Date.now() - start,
        emptyBody: true,
      };
    }
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    let attempt = 0;
    let lastResult: SearchResult | null = null;

    while (attempt <= this.maxRetries) {
      const result = await this.executeOnce(query, attempt + 1);
      lastResult = result;

      const shouldRetry =
        attempt < this.maxRetries &&
        (result.meta.emptyBody ||
          result.meta.parseError ||
          result.meta.httpStatus === 429 ||
          result.meta.httpStatus >= 500);

      if (!shouldRetry) {
        return result;
      }

      attempt += 1;
      await this.sleep(this.retryBackoffMs * attempt);
    }

    return lastResult ?? this.emptyResult(query, 1, 0, 0, true);
  }

  private async executeOnce(
    query: SearchQuery,
    attempt: number,
  ): Promise<SearchResult> {
    const hl = query.geo?.hl ?? 'en';
    const gl = query.geo?.gl ?? 'us';
    const num = query.num ?? 10;
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
      query.text,
    )}&hl=${hl}&gl=${gl}&num=${num}&brd_json=1`;

    const start = Date.now();
    try {
      const response = await fetch(`${BASE_URL}/request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          zone: this.zone,
          url: googleUrl,
          format: 'raw',
          data_format: 'parsed_light',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const text = await response.text();
      const elapsedMs = Date.now() - start;
      const emptyBody = text.length === 0;

      if (emptyBody) {
        return this.emptyResult(
          query,
          attempt,
          response.status,
          elapsedMs,
          true,
        );
      }

      let organic: Array<Record<string, unknown>> = [];
      let parseError: string | undefined;
      try {
        const data = JSON.parse(text) as { organic?: unknown };
        organic = Array.isArray(data.organic)
          ? (data.organic as Array<Record<string, unknown>>)
          : [];
      } catch (error) {
        parseError =
          error instanceof Error ? error.message : 'Invalid JSON response';
      }

      const items = organic
        .map((entry, index) => this.mapOrganic(entry, index + 1))
        .filter((item): item is SearchResultItem => item !== null);

      return {
        items,
        meta: {
          provider: 'brightdata',
          zone: this.zone,
          attempt,
          httpStatus: response.status,
          responseBytes: text.length,
          elapsedMs,
          emptyBody: false,
          parseError,
          query: query.text,
        },
      };
    } catch (error) {
      const elapsedMs = Date.now() - start;
      this.logger.warn(
        `Bright Data search failed (attempt ${attempt}): ${String(error)}`,
      );
      return {
        items: [],
        meta: {
          provider: 'brightdata',
          zone: this.zone,
          attempt,
          httpStatus: 0,
          responseBytes: 0,
          elapsedMs,
          emptyBody: true,
          parseError:
            error instanceof Error ? error.message : 'Request failed',
          query: query.text,
        },
      };
    }
  }

  private mapOrganic(
    entry: Record<string, unknown>,
    position: number,
  ): SearchResultItem | null {
    const url = String(entry.link ?? entry.url ?? '').trim();
    const title = String(entry.title ?? '').trim();
    if (!url) {
      return null;
    }
    const snippet = String(entry.description ?? entry.snippet ?? '').trim();
    return {
      title,
      url,
      snippet,
      position,
      domain: domainFromUrl(url),
    };
  }

  private emptyResult(
    query: SearchQuery,
    attempt: number,
    httpStatus: number,
    elapsedMs: number,
    emptyBody: boolean,
  ): SearchResult {
    return {
      items: [],
      meta: {
        provider: 'brightdata',
        zone: this.zone,
        attempt,
        httpStatus,
        responseBytes: 0,
        elapsedMs,
        emptyBody,
        query: query.text,
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
