import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiService } from '../../ai/ai.service';
import { buildBrandDiscoveryQueries } from '../../ai/prompts/generate-brand-discovery.prompt';
import type {
  BrandDiscoverResult,
  BrandSearchMetadata,
  BrandSourceContext,
  BrandSourceProvider,
} from '../interfaces/brand-source-provider.interface';
import type { WebSearchProvider } from '../interfaces/web-search-provider.interface';
import { ensureWebsiteUrl, normalizeDomain } from '../utils/brand-domain.util';
import {
  BRAND_SEARCH_MAX_QUERIES,
  validateBrandSearchQueries,
} from '../utils/brand-search-queries.util';

@Injectable()
export class AiPlusTavilyBrandSource implements BrandSourceProvider {
  readonly name = 'ai+brightdata';
  private readonly logger = new Logger(AiPlusTavilyBrandSource.name);

  constructor(
    private readonly webSearch: WebSearchProvider,
    private readonly aiService: AiService,
    private readonly configService: ConfigService,
  ) {}

  async discover(context: BrandSourceContext): Promise<BrandDiscoverResult> {
    const { queries, strategy, fallbackUsed, plannedQueriesCount } =
      await this.resolveSearchQueries(context);

    const hitLists = await Promise.all(
      queries.map((query) => this.webSearch.search(query, { maxResults: 6 })),
    );
    const searchHits = hitLists.flat();

    const searchMetadata: BrandSearchMetadata = {
      strategy,
      queries,
      plannedQueriesCount,
      validatedQueriesCount: queries.length,
      fallbackUsed,
      searchHitsCount: searchHits.length,
    };

    this.logger.log(
      JSON.stringify({
        event: 'brand_search_strategy',
        strategy: searchMetadata.strategy,
        plannedQueriesCount: searchMetadata.plannedQueriesCount,
        validatedQueriesCount: searchMetadata.validatedQueriesCount,
        fallbackUsed: searchMetadata.fallbackUsed,
        searchHitsCount: searchMetadata.searchHitsCount,
      }),
    );

    const scored = await this.aiService.scoreBrandCandidates({
      influencerName: context.influencerName,
      niche: context.influencerNiche,
      ibp: context.ibp,
      limit: context.limit,
      searchHits,
      instructions: context.promptInstructions,
    });

    const candidates = scored.brands.map((brand) => {
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
          : searchHits.slice(0, 3).map((hit) => hit.url),
      };
    });

    return { candidates, searchMetadata };
  }

  private async resolveSearchQueries(context: BrandSourceContext): Promise<{
    queries: string[];
    strategy: 'llm' | 'templates';
    fallbackUsed: boolean;
    plannedQueriesCount: number;
  }> {
    const mode =
      this.configService.get<string>('BRAND_SEARCH_STRATEGY') === 'templates'
        ? 'templates'
        : 'llm';

    const templateQueries = () =>
      buildBrandDiscoveryQueries(
        context.ibp,
        context.influencerName,
        context.influencerNiche,
      ).slice(0, BRAND_SEARCH_MAX_QUERIES);

    if (mode === 'templates') {
      const queries = templateQueries();
      return {
        queries,
        strategy: 'templates',
        fallbackUsed: false,
        plannedQueriesCount: queries.length,
      };
    }

    try {
      const plan = await this.aiService.planBrandSearch({
        influencerName: context.influencerName,
        niche: context.influencerNiche,
        ibp: context.ibp,
        maxQueries: BRAND_SEARCH_MAX_QUERIES,
      });
      const plannedQueriesCount = plan.queries.length;
      const validated = validateBrandSearchQueries(plan.queries, {
        maxQueries: BRAND_SEARCH_MAX_QUERIES,
        excludedSectors: context.ibp.excludedSectors,
      });

      if (validated.length === 0) {
        const queries = templateQueries();
        return {
          queries,
          strategy: 'llm',
          fallbackUsed: true,
          plannedQueriesCount,
        };
      }

      return {
        queries: validated,
        strategy: 'llm',
        fallbackUsed: false,
        plannedQueriesCount,
      };
    } catch (error) {
      this.logger.warn(
        `Brand search strategy failed; using template queries: ${String(error)}`,
      );
      const queries = templateQueries();
      return {
        queries,
        strategy: 'llm',
        fallbackUsed: true,
        plannedQueriesCount: 0,
      };
    }
  }
}
