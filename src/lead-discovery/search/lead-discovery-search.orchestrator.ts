import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { BrightDataSearchClient } from '../clients/brightdata-search.client';
import type {
  BrightDataSearchDiagnostics,
  BrightDataSearchResultCategory,
  LeadSearchDiscoveryResult,
  LinkedInCandidate,
  SearchExecutionMetadata,
  SearchFailure,
  TavilySearchDiagnostics,
} from '../interfaces/lead-search.interface';
import { CandidateProfileRanker } from './candidate-profile.ranker';
import { PersonQueryLadderBuilder } from './person-query-ladder.builder';

export type LeadDiscoverySearchInput = {
  brandName: string;
  website: string;
  domain: string;
  limit: number;
  priorityRoles?: string[];
};

type TavilyFallbackResult = {
  candidates: LinkedInCandidate[];
  executedQueries: string[];
  searchHitsCount: number;
  requestsAttempted: number;
  diagnostics: TavilySearchDiagnostics;
};

function emptyBrightDataDiagnostics(): BrightDataSearchDiagnostics {
  return {
    requests: 0,
    hits: 0,
    emptyBody: 0,
    parseError: 0,
    organicEmpty: 0,
    networkError: 0,
    httpError: 0,
    httpStatusCounts: {},
  };
}

function emptyTavilyDiagnostics(): TavilySearchDiagnostics {
  return {
    requests: 0,
    hits: 0,
    httpOkWithResults: 0,
    httpOkEmptyResults: 0,
    httpError: 0,
    networkError: 0,
    timeout: 0,
  };
}

function bumpStatusCount(
  counts: Record<string, number>,
  httpStatus: number,
): void {
  const key = String(httpStatus);
  counts[key] = (counts[key] ?? 0) + 1;
}

function tallyBrightDataAttempt(
  diagnostics: BrightDataSearchDiagnostics,
  meta: SearchExecutionMetadata,
  itemCount: number,
): void {
  diagnostics.requests += 1;
  diagnostics.hits += itemCount;
  bumpStatusCount(diagnostics.httpStatusCounts, meta.httpStatus);

  const category: BrightDataSearchResultCategory =
    meta.resultCategory ??
    (meta.httpStatus === 0
      ? 'network_error'
      : meta.emptyBody
        ? 'empty_body'
        : meta.parseError
          ? 'parse_error'
          : 'organic_empty');

  switch (category) {
    case 'empty_body':
      diagnostics.emptyBody += 1;
      break;
    case 'parse_error':
      diagnostics.parseError += 1;
      break;
    case 'organic_empty':
      diagnostics.organicEmpty += 1;
      break;
    case 'network_error':
      diagnostics.networkError += 1;
      break;
    case 'http_error':
      diagnostics.httpError += 1;
      break;
    case 'ok':
      break;
  }
}

function isBrightDataSearchFailure(
  meta: SearchExecutionMetadata,
): SearchFailure | null {
  const category = meta.resultCategory;
  if (
    category === 'empty_body' ||
    (category === undefined && meta.emptyBody && meta.httpStatus !== 0)
  ) {
    return {
      code: 'EMPTY_BODY',
      message: 'Bright Data returned empty body',
      retryable: true,
      query: meta.query,
      httpStatus: meta.httpStatus,
    };
  }
  if (category === 'network_error' || meta.httpStatus === 0) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Bright Data search network failure',
      retryable: true,
      query: meta.query,
      httpStatus: meta.httpStatus,
    };
  }
  if (category === 'parse_error' || meta.parseError) {
    return {
      code: 'PARSE_ERROR',
      message: 'Bright Data search parse error',
      retryable: true,
      query: meta.query,
      httpStatus: meta.httpStatus,
    };
  }
  if (category === 'http_error') {
    return {
      code: 'HTTP_ERROR',
      message: `Bright Data search HTTP ${meta.httpStatus}`,
      retryable: meta.httpStatus === 429 || meta.httpStatus >= 500,
      query: meta.query,
      httpStatus: meta.httpStatus,
    };
  }
  return null;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === 'TimeoutError' ||
    error.name === 'AbortError' ||
    /timeout/i.test(error.message)
  );
}

@Injectable()
export class LeadDiscoverySearchOrchestrator {
  private readonly logger = new Logger(LeadDiscoverySearchOrchestrator.name);
  private readonly ladderBuilder = new PersonQueryLadderBuilder();
  private readonly ranker = new CandidateProfileRanker();
  private readonly maxBrightDataRequests: number;
  private readonly maxTavilyRequests: number;
  private readonly fallbackMode: string;

  constructor(
    private readonly brightDataSearch: BrightDataSearchClient,
    private readonly configService: ConfigService,
  ) {
    this.maxBrightDataRequests =
      this.configService.get<number>('LEAD_DISCOVERY_MAX_SEARCH_REQUESTS') ?? 30;
    this.maxTavilyRequests =
      this.configService.get<number>('LEAD_DISCOVERY_MAX_TAVILY_FALLBACK_REQUESTS') ??
      10;
    this.fallbackMode =
      this.configService
        .get<string>('LEAD_DISCOVERY_SEARCH_FALLBACK')
        ?.trim()
        .toLowerCase() ?? 'tavily';
  }

  async discoverProfileUrls(
    input: LeadDiscoverySearchInput,
  ): Promise<LeadSearchDiscoveryResult> {
    const searchRunId = randomUUID();
    const plannedQueries = this.ladderBuilder.build({
      brandName: input.brandName,
      priorityRoles: input.priorityRoles,
    });

    const failures: SearchFailure[] = [];
    const executedQueries: string[] = [];
    let searchHitsCount = 0;
    let brightDataRequests = 0;
    let brightDataSearchFailures = 0;
    let tavilyRequests = 0;
    let queriesExecuted = 0;
    const allCandidates: LinkedInCandidate[] = [];
    const brightDataDiagnostics = emptyBrightDataDiagnostics();
    let tavilyDiagnostics = emptyTavilyDiagnostics();

    const minRequired = Math.max(1, Math.min(input.limit, 3));
    const maxCandidates = input.limit * 3;

    for (const queryText of plannedQueries) {
      if (brightDataRequests >= this.maxBrightDataRequests) {
        break;
      }
      const qualifiedSoFar = this.ranker.filterByThreshold(
        this.ranker.dedupeCandidates(allCandidates),
      );
      if (qualifiedSoFar.length >= minRequired) {
        break;
      }

      queriesExecuted += 1;
      brightDataRequests += 1;
      executedQueries.push(queryText);

      const result = await this.brightDataSearch.search({ text: queryText });
      searchHitsCount += result.items.length;
      this.logSearchAttempt(searchRunId, result.meta);
      tallyBrightDataAttempt(
        brightDataDiagnostics,
        result.meta,
        result.items.length,
      );

      const failure = isBrightDataSearchFailure(result.meta);
      if (failure) {
        brightDataSearchFailures += 1;
        failures.push(failure);
      }

      const ranked = this.ranker.rank({
        items: result.items,
        query: queryText,
        provider: 'brightdata',
        brandName: input.brandName,
        roleKeywords: input.priorityRoles,
      });
      allCandidates.push(...ranked);
    }

    let deduped = this.ranker.dedupeCandidates(allCandidates);
    let qualified = this.ranker.filterByThreshold(deduped);
    let fallbackActivated = false;

    if (qualified.length < minRequired && this.shouldUseTavilyFallback()) {
      fallbackActivated = true;
      const tavilyResult = await this.runTavilyFallback(
        plannedQueries,
        input.brandName,
        failures,
        input.priorityRoles,
      );
      tavilyRequests = tavilyResult.requestsAttempted;
      tavilyDiagnostics = tavilyResult.diagnostics;
      executedQueries.push(...tavilyResult.executedQueries);
      searchHitsCount += tavilyResult.searchHitsCount;
      allCandidates.push(...tavilyResult.candidates);
      deduped = this.ranker.dedupeCandidates(allCandidates);
      qualified = this.ranker.filterByThreshold(deduped);
    }

    const selected = qualified.slice(0, maxCandidates);
    const profileUrls = selected.map((c) => c.url);

    return {
      profileUrls,
      plannedQueries,
      executedQueries,
      searchHitsCount,
      trace: {
        searchRunId,
        brightDataRequests,
        brightDataSearchFailures,
        tavilyRequests: fallbackActivated ? tavilyRequests : 0,
        fallbackActivated,
        queriesExecuted,
        linkedinUrlValidated: allCandidates.length,
        linkedinCandidatesFound: deduped.length,
        qualifiedCandidates: qualified.length,
        selectedUrls: profileUrls,
        failures,
        brightDataDiagnostics,
        tavilyDiagnostics: fallbackActivated
          ? tavilyDiagnostics
          : emptyTavilyDiagnostics(),
      },
    };
  }

  private shouldUseTavilyFallback(): boolean {
    return this.fallbackMode === 'tavily';
  }

  private async runTavilyFallback(
    queries: string[],
    brandName: string,
    failures: SearchFailure[],
    priorityRoles?: string[],
  ): Promise<TavilyFallbackResult> {
    const diagnostics = emptyTavilyDiagnostics();
    const tavilyKey = this.configService.get<string>('TAVILY_API_KEY')?.trim();
    if (!tavilyKey) {
      this.logger.warn('Tavily fallback skipped: TAVILY_API_KEY missing');
      return {
        candidates: [],
        executedQueries: [],
        searchHitsCount: 0,
        requestsAttempted: Math.min(queries.length, this.maxTavilyRequests),
        diagnostics,
      };
    }

    const candidates: LinkedInCandidate[] = [];
    const executedQueries: string[] = [];
    let searchHitsCount = 0;
    const limit = Math.min(queries.length, this.maxTavilyRequests);

    for (let i = 0; i < limit; i += 1) {
      const queryText = queries[i];
      executedQueries.push(queryText);
      diagnostics.requests += 1;
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: queryText,
            max_results: 5,
          }),
        });

        if (!response.ok) {
          diagnostics.httpError += 1;
          failures.push({
            code: 'HTTP_ERROR',
            message: `Tavily HTTP ${response.status}`,
            retryable: false,
            query: queryText,
            httpStatus: response.status,
          });
          continue;
        }

        const payload = (await response.json()) as {
          results?: Array<{
            url?: string;
            title?: string;
            content?: string;
          }>;
        };

        const items = (payload.results ?? []).map((row, index) => ({
          title: String(row.title ?? ''),
          url: String(row.url ?? ''),
          snippet: String(row.content ?? ''),
          position: index + 1,
          domain: '',
        }));
        searchHitsCount += items.length;
        diagnostics.hits += items.length;

        if (items.length > 0) {
          diagnostics.httpOkWithResults += 1;
        } else {
          diagnostics.httpOkEmptyResults += 1;
        }

        candidates.push(
          ...this.ranker.rank({
            items,
            query: queryText,
            provider: 'tavily',
            brandName,
            roleKeywords: priorityRoles,
          }),
        );
      } catch (error) {
        if (isTimeoutError(error)) {
          diagnostics.timeout += 1;
          failures.push({
            code: 'TIMEOUT',
            message: 'Tavily request timed out',
            retryable: true,
            query: queryText,
          });
        } else {
          diagnostics.networkError += 1;
          failures.push({
            code: 'NETWORK_ERROR',
            message:
              error instanceof Error ? error.message : 'Tavily request failed',
            retryable: false,
            query: queryText,
          });
        }
      }
    }

    this.logger.log(
      JSON.stringify({
        event: 'tavily_fallback_summary',
        candidates: candidates.length,
        requests: diagnostics.requests,
        httpOkWithResults: diagnostics.httpOkWithResults,
        httpOkEmptyResults: diagnostics.httpOkEmptyResults,
        httpError: diagnostics.httpError,
        networkError: diagnostics.networkError,
        timeout: diagnostics.timeout,
        hits: diagnostics.hits,
      }),
    );
    return {
      candidates,
      executedQueries,
      searchHitsCount,
      requestsAttempted: limit,
      diagnostics,
    };
  }

  private logSearchAttempt(
    searchRunId: string,
    meta: SearchExecutionMetadata,
  ): void {
    this.logger.log(
      JSON.stringify({
        searchRunId,
        provider: meta.provider,
        query: meta.query.slice(0, 120),
        attempt: meta.attempt,
        httpStatus: meta.httpStatus,
        emptyBody: meta.emptyBody,
        resultBytes: meta.responseBytes,
        latencyMs: meta.elapsedMs,
        resultCategory: meta.resultCategory ?? null,
      }),
    );
  }
}
