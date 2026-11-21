import { Injectable, Logger } from '@nestjs/common';
import {
  agencyDiscoveryInputSchema,
  agencyDiscoveryOutputSchema,
  type AgencyDiscoveryInput,
  type AgencyDiscoveryOutput,
  type AgencySerpHit,
} from '@influence-maven/ai-contracts';

import { BrightDataSerpProviderError } from '../integrations/brightdata';
import { BrightDataWebSearchProvider } from '../brand-discovery/providers/brightdata-web-search.provider';
import { AgencyPersistenceService } from './agency-persistence.service';
import { buildAgencySearchQueries } from './utils/build-agency-search-queries';
import { classifyAgencySerpHits } from './utils/classify-agency-hit';
import { dedupeAgencySerpHits } from './utils/dedupe-agency-hits';

export const AGENCY_DISCOVERY_PROVIDER_ID = 'nest-agency-discovery-2c';

export type AgencyDiscoveryExecuteResult = {
  output: AgencyDiscoveryOutput;
  persistedCount: number;
  queries: string[];
};

/**
 * Track 2C — Agency Discovery engine (Nest SERP + classify + persist).
 * Invoked from ContactEmailMastraOrchestrator (2C.3); no separate queue.
 */
@Injectable()
export class AgencyDiscoveryService {
  private readonly logger = new Logger(AgencyDiscoveryService.name);

  constructor(
    private readonly webSearch: BrightDataWebSearchProvider,
    private readonly persistence: AgencyPersistenceService,
  ) {}

  async execute(
    rawInput: AgencyDiscoveryInput,
    options?: { persist?: boolean },
  ): Promise<AgencyDiscoveryExecuteResult> {
    const input = agencyDiscoveryInputSchema.parse(rawInput);
    const persist = options?.persist !== false;
    const providerErrors: string[] = [];

    const queries =
      input.searchHits && input.searchHits.length > 0
        ? []
        : buildAgencySearchQueries(input);

    let rawHits: AgencySerpHit[] = input.searchHits
      ? [...input.searchHits]
      : [];
    let serpCalls = 0;

    if (!input.searchHits?.length) {
      const maxPerQuery = input.maxResultsPerQuery ?? 6;
      for (const query of queries) {
        serpCalls += 1;
        try {
          const hits = await this.webSearch.search(query, {
            maxResults: maxPerQuery,
          });
          for (const hit of hits) {
            rawHits.push({
              title: hit.title,
              url: hit.url,
              content: hit.content,
            });
          }
        } catch (error) {
          if (error instanceof BrightDataSerpProviderError) {
            providerErrors.push(
              `${query}: ${error.details.resultCategory ?? error.message}`.slice(
                0,
                500,
              ),
            );
          } else {
            const message =
              error instanceof Error ? error.message : String(error);
            providerErrors.push(`${query}: ${message}`.slice(0, 500));
          }
        }
      }
    }

    const { unique, duplicateCount, droppedInvalid } =
      dedupeAgencySerpHits(rawHits);

    const niches = [
      ...(input.niches ?? []),
      ...(input.niche ? [input.niche] : []),
      ...(input.subNiche ? [input.subNiche] : []),
      ...(input.ibpTargetSectors ?? []),
    ].filter((v): v is string => Boolean(v?.trim()));

    const markets = [
      ...(input.markets ?? []),
      ...(input.ibpMarkets ?? []),
    ].filter((v): v is string => Boolean(v?.trim()));

    const candidates = classifyAgencySerpHits(unique, {
      niches,
      markets,
      country: input.country,
      fetchedAt: new Date().toISOString(),
    });

    let persistedCount = 0;
    if (persist) {
      for (const candidate of candidates) {
        // Persist all classified rows (including DISCARDED) so review UI can show why.
        try {
          await this.persistence.upsertCandidate({
            influencerId: input.influencerId,
            candidate,
            searchMetadata: {
              schemaVersion: 1,
              queries,
              serpCalls,
              searchHitsCount: rawHits.length,
              dedupedHitsCount: unique.length,
              providerId: AGENCY_DISCOVERY_PROVIDER_ID,
            },
          });
          persistedCount += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          providerErrors.push(`persist:${candidate.agency.domain}:${message}`);
          this.logger.warn(
            JSON.stringify({
              event: 'agency_discovery_persist_failed',
              influencerId: input.influencerId,
              domain: candidate.agency.domain,
              errorMessage: message.slice(0, 500),
            }),
          );
        }
      }
    }

    let outcome: AgencyDiscoveryOutput['outcome'] = 'NO_MATCHES';
    if (candidates.length > 0) {
      outcome = 'RESULTS_FOUND';
    } else if (
      providerErrors.length > 0 &&
      rawHits.length === 0 &&
      queries.length > 0
    ) {
      outcome = 'PROVIDER_FAILURE';
    }

    const output = agencyDiscoveryOutputSchema.parse({
      operation: 'DISCOVER_AGENCIES',
      outcome,
      candidates,
      summary:
        outcome === 'PROVIDER_FAILURE'
          ? `Agency SERP failed (${providerErrors.length} error(s))`
          : `Classified ${candidates.length} agenc(y/ies) from ${unique.length} unique hit(s)`,
      searchMetadata: {
        schemaVersion: 1,
        queries,
        serpCalls,
        searchHitsCount: rawHits.length,
        dedupedHitsCount: unique.length,
        classifiedCount: candidates.length,
        persistedCount,
        providerId: AGENCY_DISCOVERY_PROVIDER_ID,
        ...(providerErrors.length ? { providerErrors } : {}),
        notes: `duplicatesSkipped=${duplicateCount};invalidDropped=${droppedInvalid}`,
      },
    });

    return { output, persistedCount, queries };
  }
}
