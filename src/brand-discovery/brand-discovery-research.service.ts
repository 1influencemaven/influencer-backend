import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AiExecutionResult,
  BrandPageSnapshot,
  BrandResearchBrandOutput,
  BrandResearchPageRole,
  IbpCriteriaSnapshot,
} from '@influence-maven/ai-contracts';

import { AiExecutionPublisherService } from '../ai-execution/ai-execution-publisher.service';
import { AiExecutionWaitError } from '../ai-execution/ai-execution-result-wait.errors';
import { AiExecutionResultWaitService } from '../ai-execution/ai-execution-result-wait.service';
import {
  BrightDataSearchClient,
  sanitizeUnlockerErrorMessage,
} from '../integrations/brightdata';
import type { RawBrandCandidate } from './interfaces/brand-source-provider.interface';
import { BrightDataWebSearchProvider } from './providers/brightdata-web-search.provider';
import { htmlToResearchText } from './utils/brand-research-html.util';
import {
  type DeepResearchMetadata,
  mergeDeepResearchIntoCandidate,
} from './utils/brand-research-merge.util';
import {
  BRAND_RESEARCH_MAX_PAGES,
  buildBrandResearchPageCandidates,
} from './utils/brand-research-pages.util';
import {
  assertBrandResearchUrl,
  extractCanonicalOrFinalUrlHint,
} from './utils/brand-research-url-guard.util';
import {
  computeNestResearchStatus,
  scrubOrphanEvidence,
  type NestResearchStatus,
} from './utils/brand-research-validate.util';
import { mapPool } from './utils/map-pool.util';
import { filterBrandDiscoverySearchHits } from './utils/brand-serp-hit-filter.util';

export const BRAND_DISCOVERY_RESEARCH_DEFAULT_CONCURRENCY = 2;
export const BRAND_DISCOVERY_RESEARCH_DEFAULT_TIMEOUT_MS = 300_000;

export type BrandDiscoveryResearchContext = {
  runId: string;
  userId: string;
  influencerId: string;
  influencerName: string;
  niche?: string | null;
  subNiche?: string | null;
  country?: string | null;
  language?: string | null;
  followers?: number | null;
  engagement?: number | null;
  ibp: IbpCriteriaSnapshot;
  promptInstructions: string;
};

type PageFetchRecord = DeepResearchMetadata['pages'][number];

@Injectable()
export class BrandDiscoveryResearchService {
  private readonly logger = new Logger(BrandDiscoveryResearchService.name);

  constructor(
    private readonly unlocker: BrightDataSearchClient,
    private readonly webSearch: BrightDataWebSearchProvider,
    private readonly publisher: AiExecutionPublisherService,
    private readonly resultWait: AiExecutionResultWaitService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Deep-research each toPersist candidate with limited concurrency.
   * Failures are isolated — SCORE candidate is always returned.
   */
  async enrichCandidates(
    candidates: RawBrandCandidate[],
    context: BrandDiscoveryResearchContext,
  ): Promise<{
    candidates: RawBrandCandidate[];
    researchedCount: number;
    researchFailedCount: number;
    researchPartialCount: number;
    researchConcurrency: number;
  }> {
    const concurrency = this.resolveConcurrency();
    if (!this.isResearchEnabled()) {
      this.logger.log(
        JSON.stringify({
          event: 'brand_discovery_research_skipped',
          runId: context.runId,
          reason: 'BRAND_DISCOVERY_RESEARCH_ENABLED=false',
          candidates: candidates.length,
        }),
      );
      return {
        candidates,
        researchedCount: 0,
        researchFailedCount: 0,
        researchPartialCount: 0,
        researchConcurrency: concurrency,
      };
    }
    const results = await mapPool(candidates, concurrency, async (candidate) => {
      try {
        return await this.researchOne(candidate, context);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'research_unknown_error';
        this.logger.warn(
          JSON.stringify({
            event: 'brand_discovery_research_isolated_error',
            runId: context.runId,
            domain: candidate.domain,
            errorMessage: sanitizeUnlockerErrorMessage(message),
          }),
        );
        return mergeDeepResearchIntoCandidate({
          candidate,
          nestResearchStatus: 'FAILED',
          agentOutput: null,
          pages: [],
          warnings: [sanitizeUnlockerErrorMessage(message)],
        });
      }
    });

    let researchedCount = 0;
    let researchFailedCount = 0;
    let researchPartialCount = 0;
    for (const c of results) {
      const status = (
        c.metadata as { deepResearch?: { researchStatus?: NestResearchStatus } }
      )?.deepResearch?.researchStatus;
      if (status === 'COMPLETED') researchedCount += 1;
      else if (status === 'PARTIAL') {
        researchedCount += 1;
        researchPartialCount += 1;
      } else if (status === 'FAILED') {
        researchFailedCount += 1;
      }
    }

    return {
      candidates: results,
      researchedCount,
      researchFailedCount,
      researchPartialCount,
      researchConcurrency: concurrency,
    };
  }

  private async researchOne(
    candidate: RawBrandCandidate,
    context: BrandDiscoveryResearchContext,
  ): Promise<RawBrandCandidate> {
    const extraUrls = await this.suggestExtraUrlsFromSerp(candidate);
    const planned = buildBrandResearchPageCandidates({
      website: candidate.website,
      domain: candidate.domain,
      extraUrls,
      maxPages: BRAND_RESEARCH_MAX_PAGES,
    });

    const pages: PageFetchRecord[] = [];
    const snapshots: BrandPageSnapshot[] = [];

    for (const page of planned) {
      const fetched = await this.fetchAuthorizedPage(
        page.url,
        page.role,
        candidate.domain,
      );
      pages.push(fetched.record);
      if (fetched.snapshot) {
        snapshots.push(fetched.snapshot);
      }
    }

    const pagesOk = pages.filter((p) => p.fetchStatus === 'ok').length;
    if (pagesOk === 0 || snapshots.length === 0) {
      return mergeDeepResearchIntoCandidate({
        candidate,
        nestResearchStatus: 'FAILED',
        agentOutput: null,
        pages,
        warnings: ['No usable pages from Web Unlocker'],
      });
    }

    let agentOutput: BrandResearchBrandOutput | null = null;
    let agentFailed = false;
    let failureWarning: string | undefined;
    try {
      const timeoutMs = this.resolveResearchTimeoutMs();
      const { executionId } =
        await this.publisher.publishBrandDiscoveryResearch({
          timeoutMs,
          runId: context.runId,
          userId: context.userId,
          influencerId: context.influencerId,
          influencerName: context.influencerName,
          niche: context.niche,
          subNiche: context.subNiche,
          country: context.country,
          language: context.language,
          followers: context.followers,
          engagement: context.engagement,
          ibp: context.ibp,
          brand: {
            name: candidate.name,
            website: candidate.website,
            domain: candidate.domain,
          },
          pageSnapshots: snapshots,
          maxPages: BRAND_RESEARCH_MAX_PAGES,
          promptInstructions: context.promptInstructions,
        });

      const result = await this.resultWait.waitForAiExecutionResult(
        executionId,
        timeoutMs,
      );

      if (
        result.status !== 'COMPLETED' ||
        result.type !== 'BRAND_DISCOVERY' ||
        !result.output ||
        result.output.operation !== 'RESEARCH_BRAND'
      ) {
        agentFailed = true;
        failureWarning = formatResearchFailureWarning(result);
      } else {
        const allowed = snapshots.map((s) => s.url);
        agentOutput = scrubOrphanEvidence(result.output, allowed);
        // Prefer Nest page fetch records over agent pages for persistence
        agentOutput = {
          ...agentOutput,
          pages: pages.slice(0, 4).map((p) => ({
            url: p.url,
            role: p.role as BrandResearchPageRole,
            fetchStatus: p.fetchStatus as BrandResearchBrandOutput['pages'][number]['fetchStatus'],
            httpStatus: p.httpStatus,
            errorMessage: p.errorMessage,
          })),
        };
      }
    } catch (error) {
      agentFailed = true;
      failureWarning = formatResearchWaitFailureWarning(error);
    }

    const nestStatus = computeNestResearchStatus({
      pagesOk,
      pagesAttempted: pages.length,
      agentOutput,
      agentFailed,
    });

    return mergeDeepResearchIntoCandidate({
      candidate,
      nestResearchStatus: nestStatus,
      agentOutput,
      pages: pages.slice(0, 4),
      warnings: agentFailed
        ? [failureWarning ?? 'Mastra RESEARCH_BRAND failed']
        : undefined,
    });
  }

  private async fetchAuthorizedPage(
    url: string,
    role: BrandResearchPageRole,
    brandDomain: string,
  ): Promise<{
    record: PageFetchRecord;
    snapshot: BrandPageSnapshot | null;
  }> {
    const guarded = assertBrandResearchUrl(url, brandDomain);
    if (!guarded.ok) {
      return {
        record: {
          url,
          role,
          fetchStatus: 'rejected',
          errorMessage: guarded.reason,
        },
        snapshot: null,
      };
    }

    const fetched = await this.unlocker.fetchRawHtml(guarded.url);
    if (fetched.outcome !== 'ok' || fetched.emptyBody) {
      return {
        record: {
          url: guarded.url,
          role,
          fetchStatus:
            fetched.outcome === 'ok' ? 'empty_body' : fetched.outcome,
          httpStatus: fetched.httpStatus || undefined,
          errorMessage: fetched.errorMessage,
        },
        snapshot: null,
      };
    }

    const hint = extractCanonicalOrFinalUrlHint(fetched.html);
    if (hint) {
      const finalGuard = assertBrandResearchUrl(hint, brandDomain);
      if (!finalGuard.ok) {
        return {
          record: {
            url: guarded.url,
            role,
            fetchStatus: 'rejected',
            httpStatus: fetched.httpStatus,
            errorMessage: `final_url_${finalGuard.reason}`,
          },
          snapshot: null,
        };
      }
    }

    const textContent = htmlToResearchText(fetched.html);
    if (!textContent) {
      return {
        record: {
          url: guarded.url,
          role,
          fetchStatus: 'empty_body',
          httpStatus: fetched.httpStatus,
        },
        snapshot: null,
      };
    }

    return {
      record: {
        url: guarded.url,
        role,
        fetchStatus: 'ok',
        httpStatus: fetched.httpStatus,
      },
      snapshot: {
        url: guarded.url,
        role,
        textContent,
      },
    };
  }

  private async suggestExtraUrlsFromSerp(
    candidate: RawBrandCandidate,
  ): Promise<string[]> {
    try {
      const query = `site:${candidate.domain} (about OR partners OR affiliate OR creators OR company)`;
      const hits = await this.webSearch.search(query, { maxResults: 4 });
      const filtered = filterBrandDiscoverySearchHits(hits);
      return filtered
        .map((h) => h.url)
        .filter((u) => assertBrandResearchUrl(u, candidate.domain).ok)
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  private resolveConcurrency(): number {
    const raw = Number(
      this.configService.get<number | string>(
        'BRAND_DISCOVERY_RESEARCH_CONCURRENCY',
      ) ?? BRAND_DISCOVERY_RESEARCH_DEFAULT_CONCURRENCY,
    );
    if (!Number.isFinite(raw)) {
      return BRAND_DISCOVERY_RESEARCH_DEFAULT_CONCURRENCY;
    }
    return Math.max(1, Math.min(5, Math.floor(raw)));
  }

  /** Deep research (Unlocker + RESEARCH_BRAND) is optional; default on. */
  private isResearchEnabled(): boolean {
    const raw = this.configService.get<boolean | string>(
      'BRAND_DISCOVERY_RESEARCH_ENABLED',
    );
    return !(raw === false || String(raw).toLowerCase() === 'false');
  }

  private resolveResearchTimeoutMs(): number {
    const raw = Number(
      this.configService.get<number | string>(
        'BRAND_DISCOVERY_RESEARCH_TIMEOUT_MS',
      ) ?? BRAND_DISCOVERY_RESEARCH_DEFAULT_TIMEOUT_MS,
    );
    if (!Number.isFinite(raw) || raw < 1000) {
      return BRAND_DISCOVERY_RESEARCH_DEFAULT_TIMEOUT_MS;
    }
    return Math.floor(raw);
  }
}

/** Surface worker error codes (e.g. AI_CONTEXT_INVALID); never pretend they are timeouts. */
export function formatResearchFailureWarning(result: AiExecutionResult): string {
  if (result.status === 'FAILED' && result.error?.code) {
    const detail = result.error.message?.trim()
      ? ` — ${result.error.message.trim().slice(0, 400)}`
      : '';
    return `Mastra RESEARCH_BRAND failed: ${result.error.code}${detail}`;
  }
  if (result.type !== 'BRAND_DISCOVERY') {
    return `Mastra RESEARCH_BRAND failed: unexpected result type ${result.type}`;
  }
  if (result.status === 'COMPLETED' && result.output?.operation !== 'RESEARCH_BRAND') {
    return `Mastra RESEARCH_BRAND failed: unexpected operation ${result.output?.operation ?? 'missing'}`;
  }
  return `Mastra RESEARCH_BRAND failed: status=${result.status}`;
}

export function formatResearchWaitFailureWarning(error: unknown): string {
  if (error instanceof AiExecutionWaitError) {
    return `Mastra RESEARCH_BRAND wait failed: ${error.code}`;
  }
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown_error');
  return `Mastra RESEARCH_BRAND failed: ${sanitizeUnlockerErrorMessage(message).slice(0, 400)}`;
}
