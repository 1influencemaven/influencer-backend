import { Injectable } from '@nestjs/common';

import {
  BrightDataSearchClient,
  BrightDataSerpProviderError,
  type BrightDataSearchResultCategory,
  type SearchExecutionMetadata,
} from '../../integrations/brightdata';
import type { BrandDiscoverySerpQueryDiagnostic } from '../interfaces/brand-source-provider.interface';
import type {
  WebSearchHit,
  WebSearchProvider,
} from '../interfaces/web-search-provider.interface';

const DEFAULT_MAX_RESULTS = 6;

/** Hard failures — Brand Discovery aborts (does not SCORE with fabricated empty). */
const FAILURE_CATEGORIES = new Set<BrightDataSearchResultCategory>([
  'http_error',
  'network_error',
  'parse_error',
  'empty_body',
]);

/**
 * Soft zero-hit outcomes — return [] without throwing so SCORE may still run.
 * Includes anomalous HTML classes (AI-004.5.1.1); not conflated as "success".
 */
const SOFT_ZERO_HIT_CATEGORIES = new Set<BrightDataSearchResultCategory>([
  'organic_empty',
  'consent_page',
  'soft_block',
  'unknown_html',
]);

export type WebSearchWithDiagnostics = {
  hits: WebSearchHit[];
  diagnostic: BrandDiscoverySerpQueryDiagnostic;
};

function toBrandDiscoveryCategory(
  category: BrightDataSearchResultCategory | undefined,
): BrandDiscoverySerpQueryDiagnostic['resultCategory'] {
  if (!category || category === 'ok') {
    return 'organic_results';
  }
  return category;
}

function buildDiagnostic(
  meta: SearchExecutionMetadata,
): BrandDiscoverySerpQueryDiagnostic {
  return {
    query: meta.query,
    resultCategory: toBrandDiscoveryCategory(meta.resultCategory),
    httpStatus: meta.httpStatus,
    responseBytes: meta.responseBytes,
    latencyMs: meta.elapsedMs,
    attempts: meta.attempt,
    organicResultsCount: meta.organicResultsCount ?? 0,
    ...(meta.parseError ? { parseError: meta.parseError } : {}),
    ...(meta.zone ? { zone: meta.zone } : {}),
  };
}

@Injectable()
export class BrightDataWebSearchProvider implements WebSearchProvider {
  readonly name = 'brightdata';

  constructor(private readonly client: BrightDataSearchClient) {}

  async search(
    query: string,
    options?: { maxResults?: number },
  ): Promise<WebSearchHit[]> {
    const { hits } = await this.searchWithDiagnostics(query, options);
    return hits;
  }

  /**
   * Same SERP call as `search`, plus per-query diagnostics for searchMetadata.
   */
  async searchWithDiagnostics(
    query: string,
    options?: { maxResults?: number },
  ): Promise<WebSearchWithDiagnostics> {
    const result = await this.client.search({
      text: query,
      num: options?.maxResults ?? DEFAULT_MAX_RESULTS,
    });

    const category = result.meta.resultCategory ?? 'empty_body';
    const diagnostic = buildDiagnostic(result.meta);
    const isConfigError =
      result.meta.parseError === 'BRIGHTDATA_SERP_ZONE_NOT_CONFIGURED';

    if (isConfigError || FAILURE_CATEGORIES.has(category)) {
      throw new BrightDataSerpProviderError(
        isConfigError
          ? 'Bright Data SERP zone is not configured'
          : `Bright Data SERP failed (${category})`,
        {
          resultCategory: isConfigError ? 'config_error' : category,
          httpStatus: result.meta.httpStatus,
          zone: result.meta.zone,
          ...(result.meta.parseError
            ? { parseError: result.meta.parseError }
            : {}),
        },
      );
    }

    // ok / soft zero-hit categories → hits (possibly [])
    if (category !== 'ok' && !SOFT_ZERO_HIT_CATEGORIES.has(category)) {
      throw new BrightDataSerpProviderError(
        `Bright Data SERP failed (${category})`,
        {
          resultCategory: category,
          httpStatus: result.meta.httpStatus,
          zone: result.meta.zone,
          ...(result.meta.parseError
            ? { parseError: result.meta.parseError }
            : {}),
        },
      );
    }

    const hits = result.items
      .filter((item) => Boolean(item.url))
      .map((item) => ({
        title: item.title || item.domain || item.url,
        url: item.url,
        content: item.snippet,
      }));

    return { hits, diagnostic };
  }
}
