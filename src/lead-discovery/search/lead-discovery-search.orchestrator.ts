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

@Injectable()
export class LeadDiscoverySearchOrchestrator {
  private readonly logger = new Logger(LeadDiscoverySearchOrchestrator.name);
  private readonly ladderBuilder = new PersonQueryLadderBuilder();
  private readonly ranker = new CandidateProfileRanker();
  private readonly maxBrightDataRequests: number;

  constructor(
    private readonly brightDataSearch: BrightDataSearchClient,
    private readonly configService: ConfigService,
  ) {
    this.maxBrightDataRequests =
      this.configService.get<number>('LEAD_DISCOVERY_MAX_SEARCH_REQUESTS') ?? 30;
  }

  /**
   * Discovers LinkedIn profile URLs via Bright Data Search only.
   * No external search fallback (Tavily removed).
   */
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
    let queriesExecuted = 0;
    const allCandidates: LinkedInCandidate[] = [];
    const brightDataDiagnostics = emptyBrightDataDiagnostics();

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

    const deduped = this.ranker.dedupeCandidates(allCandidates);
    const qualified = this.ranker.filterByThreshold(deduped);
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
        /** Always 0 — Tavily fallback removed. Kept for trace shape / historical readers. */
        tavilyRequests: 0,
        fallbackActivated: false,
        queriesExecuted,
        linkedinUrlValidated: allCandidates.length,
        linkedinCandidatesFound: deduped.length,
        qualifiedCandidates: qualified.length,
        selectedUrls: profileUrls,
        failures,
        brightDataDiagnostics,
      },
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
