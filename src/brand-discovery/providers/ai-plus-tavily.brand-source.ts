import { Injectable } from '@nestjs/common';

import { AiService } from '../../ai/ai.service';
import {
  buildBrandDiscoveryQueries,
} from '../../ai/prompts/generate-brand-discovery.prompt';
import type {
  BrandSourceContext,
  BrandSourceProvider,
  RawBrandCandidate,
} from '../interfaces/brand-source-provider.interface';
import type { WebSearchProvider } from '../interfaces/web-search-provider.interface';
import {
  ensureWebsiteUrl,
  normalizeDomain,
} from '../utils/brand-domain.util';

@Injectable()
export class AiPlusTavilyBrandSource implements BrandSourceProvider {
  readonly name = 'ai+tavily';

  constructor(
    private readonly webSearch: WebSearchProvider,
    private readonly aiService: AiService,
  ) {}

  async discover(context: BrandSourceContext): Promise<RawBrandCandidate[]> {
    const queries = buildBrandDiscoveryQueries(
      context.ibp,
      context.influencerName,
      context.influencerNiche,
    ).slice(0, 4);

    const hitLists = await Promise.all(
      queries.map((query) => this.webSearch.search(query, { maxResults: 6 })),
    );
    const searchHits = hitLists.flat();

    const scored = await this.aiService.scoreBrandCandidates({
      influencerName: context.influencerName,
      niche: context.influencerNiche,
      ibp: context.ibp,
      limit: context.limit,
      searchHits,
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
          : searchHits.slice(0, 3).map((hit) => hit.url),
      };
    });
  }
}
