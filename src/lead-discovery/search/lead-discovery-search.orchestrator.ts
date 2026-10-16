import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { BrightDataSearchClient } from '../clients/brightdata-search.client';
import type {
  LeadSearchDiscoveryResult,
  LinkedInCandidate,
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

type TavilyFallbackResult = {
  candidates: LinkedInCandidate[];
  executedQueries: string[];
  searchHitsCount: number;
  requestsAttempted: number;
};

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
    let tavilyRequests = 0;
    let queriesExecuted = 0;
    const allCandidates: LinkedInCandidate[] = [];

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

      if (result.meta.emptyBody) {
        failures.push({
          code: 'EMPTY_BODY',
          message: 'Bright Data returned empty body',
          retryable: true,
          query: queryText,
          httpStatus: result.meta.httpStatus,
        });
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
        tavilyRequests: fallbackActivated ? tavilyRequests : 0,
        fallbackActivated,
        queriesExecuted,
        linkedinCandidatesFound: deduped.length,
        selectedUrls: profileUrls,
        failures,
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
    const tavilyKey = this.configService.get<string>('TAVILY_API_KEY')?.trim();
    if (!tavilyKey) {
      this.logger.warn('Tavily fallback skipped: TAVILY_API_KEY missing');
      return {
        candidates: [],
        executedQueries: [],
        searchHitsCount: 0,
        requestsAttempted: Math.min(queries.length, this.maxTavilyRequests),
      };
    }

    const candidates: LinkedInCandidate[] = [];
    const executedQueries: string[] = [];
    let searchHitsCount = 0;
    const limit = Math.min(queries.length, this.maxTavilyRequests);

    for (let i = 0; i < limit; i += 1) {
      const queryText = queries[i];
      executedQueries.push(queryText);
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
        failures.push({
          code: 'HTTP_ERROR',
          message:
            error instanceof Error ? error.message : 'Tavily request failed',
          retryable: false,
          query: queryText,
        });
      }
    }

    this.logger.log(
      `Tavily fallback executed for brand search (${candidates.length} candidates)`,
    );
    return {
      candidates,
      executedQueries,
      searchHitsCount,
      requestsAttempted: limit,
    };
  }

  private logSearchAttempt(
    searchRunId: string,
    meta: {
      provider: string;
      query: string;
      attempt: number;
      httpStatus: number;
      emptyBody: boolean;
      responseBytes: number;
      elapsedMs: number;
    },
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
      }),
    );
  }
}
