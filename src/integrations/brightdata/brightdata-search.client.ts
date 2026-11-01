import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import type {
  BrightDataSearchResultCategory,
  SearchQuery,
  SearchResult,
  SearchResultItem,
} from './search.types';
import { domainFromUrl } from './url-domain.util';
import {
  classifyUnlockerException,
  classifyUnlockerHttpResult,
  sanitizeUnlockerErrorMessage,
  type UnlockerFetchResult,
} from './unlocker-fetch.util';

const BASE_URL = 'https://api.brightdata.com';

/** Protocol + hostname only — never path, query, or credentials. */
function apiEndpointSummary(baseUrl: string): {
  apiProtocol: string;
  apiHostname: string;
} {
  try {
    const parsed = new URL(baseUrl);
    return {
      apiProtocol: parsed.protocol.replace(/:$/, ''),
      apiHostname: parsed.hostname,
    };
  } catch {
    return { apiProtocol: 'unknown', apiHostname: 'unknown' };
  }
}

@Injectable()
export class BrightDataSearchClient {
  private readonly logger = new Logger(BrightDataSearchClient.name);
  private readonly apiKey: string;
  /** SERP API zone only — never reuse Unlocker zone for search(). */
  private readonly serpZone: string;
  /** Web Unlocker zone only — never reuse SERP zone for fetchRawHtml(). */
  private readonly unlockerZone: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly apiEndpoint = apiEndpointSummary(BASE_URL);

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      this.configService.get<string>('BRIGHTDATA_API_KEY')?.trim() ?? '';
    this.serpZone =
      this.configService.get<string>('BRIGHTDATA_SERP_ZONE')?.trim() ?? '';
    this.unlockerZone =
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

  /** True when SERP zone is set (required for search(); not shared with Unlocker). */
  isSerpConfigured(): boolean {
    return Boolean(this.apiKey && this.serpZone);
  }

  getSerpZone(): string {
    return this.serpZone;
  }

  getUnlockerZone(): string {
    return this.unlockerZone;
  }

  /**
   * Fetch raw HTML via Web Unlocker (`BRIGHTDATA_UNLOCKER_ZONE`).
   * `httpStatus` is the Bright Data API status for `/request`, not the target site.
   * Legacy fields (`html`, `emptyBody`, …) preserved; `outcome` carries the cause.
   */
  async fetchRawHtml(url: string): Promise<UnlockerFetchResult> {
    const requestId = randomUUID();
    const start = Date.now();
    const zone = this.unlockerZone;
    try {
      const response = await fetch(`${BASE_URL}/request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          zone,
          url,
          format: 'raw',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const html = await response.text();
      const bodyLength = html.length;
      const emptyBody = bodyLength === 0;
      const outcome = classifyUnlockerHttpResult({
        httpStatus: response.status,
        bodyLength,
      });
      const result: UnlockerFetchResult = {
        html,
        httpStatus: response.status,
        elapsedMs: Date.now() - start,
        emptyBody,
        bodyLength,
        zone,
        outcome,
      };

      if (outcome !== 'ok') {
        this.logger.warn(
          JSON.stringify({
            event: 'brightdata_unlocker_fetch',
            operation: 'fetch_html',
            requestId,
            provider: 'brightdata',
            url,
            zone,
            zoneKind: 'unlocker',
            outcome,
            apiHttpStatus: response.status,
            bodyLength,
            elapsedMs: result.elapsedMs,
            ...(outcome === 'empty_body' && response.status >= 200 && response.status < 300
              ? {
                  emptyBodyHint:
                    'HTTP 2xx with empty body — check Unlocker zone / credits / URL',
                }
              : {}),
          }),
        );
      }

      return result;
    } catch (error) {
      const classified = classifyUnlockerException(error);
      const elapsedMs = Date.now() - start;
      this.logger.warn(
        JSON.stringify({
          event: 'brightdata_unlocker_fetch',
          operation: 'fetch_html',
          requestId,
          provider: 'brightdata',
          url,
          zone,
          zoneKind: 'unlocker',
          outcome: classified.outcome,
          apiHttpStatus: 0,
          bodyLength: 0,
          elapsedMs,
          errorName: classified.errorName,
          errorMessage: classified.errorMessage,
          ...(classified.causeName
            ? { causeName: classified.causeName }
            : {}),
          ...(classified.causeCode
            ? { causeCode: classified.causeCode }
            : {}),
          ...(classified.causeSyscall
            ? { causeSyscall: classified.causeSyscall }
            : {}),
          ...(classified.causeHostname
            ? { causeHostname: classified.causeHostname }
            : {}),
          ...(classified.causePort !== undefined
            ? { causePort: classified.causePort }
            : {}),
        }),
      );
      return {
        html: '',
        httpStatus: 0,
        elapsedMs,
        emptyBody: true,
        bodyLength: 0,
        zone,
        outcome: classified.outcome,
        errorName: classified.errorName,
        errorMessage: sanitizeUnlockerErrorMessage(classified.errorMessage),
        ...(classified.causeName
          ? { causeName: classified.causeName }
          : {}),
        ...(classified.causeCode
          ? { causeCode: classified.causeCode }
          : {}),
        ...(classified.causeSyscall
          ? { causeSyscall: classified.causeSyscall }
          : {}),
        ...(classified.causeHostname
          ? { causeHostname: classified.causeHostname }
          : {}),
        ...(classified.causePort !== undefined
          ? { causePort: classified.causePort }
          : {}),
      };
    }
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    if (!this.serpZone) {
      this.logger.warn(
        JSON.stringify({
          event: 'brightdata_search',
          operation: 'search',
          failureKind: 'config',
          resultCategory: 'empty_body',
          message:
            'BRIGHTDATA_SERP_ZONE is not set — SERP must not reuse Unlocker zone',
        }),
      );
      return {
        items: [],
        meta: {
          provider: 'brightdata',
          zone: '',
          attempt: 1,
          httpStatus: 0,
          responseBytes: 0,
          elapsedMs: 0,
          emptyBody: true,
          parseError: 'BRIGHTDATA_SERP_ZONE_NOT_CONFIGURED',
          query: query.text,
          resultCategory: 'empty_body',
        },
      };
    }

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
    const requestId = randomUUID();
    const zone = this.serpZone;
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
          zone,
          url: googleUrl,
          format: 'raw',
          data_format: 'parsed_light',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const text = await response.text();
      const elapsedMs = Date.now() - start;
      const emptyBody = text.length === 0;
      const httpStatus = response.status;

      if (httpStatus < 200 || httpStatus >= 300) {
        this.logger.warn(
          JSON.stringify({
            event: 'brightdata_search',
            operation: 'search',
            failureKind: 'http',
            requestId,
            provider: 'brightdata',
            apiProtocol: this.apiEndpoint.apiProtocol,
            apiHostname: this.apiEndpoint.apiHostname,
            httpMethod: 'POST',
            apiPath: '/request',
            zone,
            zoneKind: 'serp',
            attempt,
            apiHttpStatus: httpStatus,
            bodyLength: text.length,
            elapsedMs,
            resultCategory: 'http_error',
          }),
        );
        return this.emptyResult(
          query,
          attempt,
          httpStatus,
          elapsedMs,
          emptyBody,
          text.length,
          'http_error',
        );
      }

      if (emptyBody) {
        this.logger.warn(
          JSON.stringify({
            event: 'brightdata_search',
            operation: 'search',
            failureKind: 'http',
            requestId,
            provider: 'brightdata',
            apiProtocol: this.apiEndpoint.apiProtocol,
            apiHostname: this.apiEndpoint.apiHostname,
            httpMethod: 'POST',
            apiPath: '/request',
            zone,
            zoneKind: 'serp',
            attempt,
            apiHttpStatus: httpStatus,
            bodyLength: 0,
            elapsedMs,
            resultCategory: 'empty_body',
            emptyBodyHint:
              'HTTP 200 with empty SERP body — verify BRIGHTDATA_SERP_ZONE (not Unlocker)',
          }),
        );
        return this.emptyResult(
          query,
          attempt,
          httpStatus,
          elapsedMs,
          true,
          0,
          'empty_body',
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

      if (parseError) {
        return {
          items: [],
          meta: {
            provider: 'brightdata',
            zone,
            attempt,
            httpStatus,
            responseBytes: text.length,
            elapsedMs,
            emptyBody: false,
            parseError,
            query: query.text,
            resultCategory: 'parse_error',
          },
        };
      }

      const items = organic
        .map((entry, index) => this.mapOrganic(entry, index + 1))
        .filter((item): item is SearchResultItem => item !== null);

      const resultCategory: BrightDataSearchResultCategory =
        items.length > 0 ? 'ok' : 'organic_empty';

      return {
        items,
        meta: {
          provider: 'brightdata',
          zone,
          attempt,
          httpStatus,
          responseBytes: text.length,
          elapsedMs,
          emptyBody: false,
          query: query.text,
          resultCategory,
        },
      };
    } catch (error) {
      const elapsedMs = Date.now() - start;
      const classified = classifyUnlockerException(error);
      // Transport failure: fetch() never got an HTTP response from Bright Data.
      const resultCategory: BrightDataSearchResultCategory = 'network_error';
      this.logger.warn(
        JSON.stringify({
          event: 'brightdata_search',
          operation: 'search',
          failureKind: 'transport',
          requestId,
          provider: 'brightdata',
          apiProtocol: this.apiEndpoint.apiProtocol,
          apiHostname: this.apiEndpoint.apiHostname,
          httpMethod: 'POST',
          apiPath: '/request',
          zone,
          zoneKind: 'serp',
          attempt,
          apiHttpStatus: 0,
          bodyLength: 0,
          elapsedMs,
          resultCategory,
          unlockerOutcome: classified.outcome,
          errorName: classified.errorName,
          errorMessage: classified.errorMessage,
          ...(classified.causeName
            ? { causeName: classified.causeName }
            : {}),
          ...(classified.causeCode
            ? { causeCode: classified.causeCode }
            : {}),
          ...(classified.causeSyscall
            ? { causeSyscall: classified.causeSyscall }
            : {}),
          ...(classified.causeHostname
            ? { causeHostname: classified.causeHostname }
            : {}),
          ...(classified.causePort !== undefined
            ? { causePort: classified.causePort }
            : {}),
        }),
      );
      return {
        items: [],
        meta: {
          provider: 'brightdata',
          zone,
          attempt,
          httpStatus: 0,
          responseBytes: 0,
          elapsedMs,
          emptyBody: true,
          parseError: classified.causeCode
            ? `${classified.errorMessage} [${classified.causeCode}]`
            : classified.errorMessage,
          query: query.text,
          resultCategory,
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
    responseBytes = 0,
    resultCategory: BrightDataSearchResultCategory = 'empty_body',
  ): SearchResult {
    return {
      items: [],
      meta: {
        provider: 'brightdata',
        zone: this.serpZone,
        attempt,
        httpStatus,
        responseBytes,
        elapsedMs,
        emptyBody,
        query: query.text,
        resultCategory,
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
