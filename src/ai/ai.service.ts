import { Inject, Injectable, Logger } from '@nestjs/common';

import type { IbpCriteriaSnapshot } from '../brand-discovery/interfaces/brand-source-provider.interface';
import type { WebSearchHit } from '../brand-discovery/interfaces/web-search-provider.interface';
import {
  LLM_PROVIDER_TOKEN,
  type LlmProvider,
} from './interfaces/llm-provider.interface';
import {
  buildBrandDiscoveryCorrectionPrompt,
  buildScoreBrandsPrompt,
} from './prompts/generate-brand-discovery.prompt';
import {
  buildBrandSearchStrategyCorrectionPrompt,
  buildBrandSearchStrategyPrompt,
} from './prompts/generate-brand-search-strategy.prompt';
import {
  buildLeadDiscoveryCorrectionPrompt,
  buildPlanLeadDiscoveryPrompt,
  DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS,
} from './prompts/generate-lead-discovery.prompt';
import {
  parseBrandDiscoveryOutput,
  type BrandDiscoveryOutput,
} from './schemas/brand-discovery-output.schema';
import {
  parseBrandSearchStrategyPlan,
  type BrandSearchStrategyPlan,
} from './schemas/brand-search-strategy.schema';
import {
  parseLeadDiscoveryPlan,
  type LeadDiscoveryPlan,
} from './schemas/lead-discovery-plan.schema';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN) private readonly llmProvider: LlmProvider,
  ) {}

  async scoreBrandCandidates(input: {
    influencerName: string;
    niche?: string | null;
    ibp: IbpCriteriaSnapshot;
    limit: number;
    searchHits: WebSearchHit[];
    seedBrands?: Array<{
      name: string;
      website: string;
      sector?: string;
      market?: string;
      brandSize?: string;
      evidenceUrls?: string[];
    }>;
    instructions?: string;
  }): Promise<BrandDiscoveryOutput> {
    const prompt = buildScoreBrandsPrompt(input);
    let rawResponse = await this.llmProvider.complete(prompt);

    try {
      return parseBrandDiscoveryOutput(rawResponse);
    } catch (firstError) {
      const errorMessage =
        firstError instanceof Error ? firstError.message : 'Invalid JSON';

      this.logger.warn(
        `Brand discovery parse failed, retrying: ${errorMessage}`,
      );

      rawResponse = await this.llmProvider.complete(
        buildBrandDiscoveryCorrectionPrompt(rawResponse, errorMessage),
      );
      return parseBrandDiscoveryOutput(rawResponse);
    }
  }

  /**
   * Plans Bright Data search queries only. Does not search, score, or persist.
   */
  async planBrandSearch(input: {
    influencerName: string;
    niche?: string | null;
    ibp: IbpCriteriaSnapshot;
    maxQueries: number;
  }): Promise<BrandSearchStrategyPlan> {
    const prompt = buildBrandSearchStrategyPrompt(input);
    let rawResponse = await this.llmProvider.complete(prompt);

    try {
      return parseBrandSearchStrategyPlan(rawResponse);
    } catch (firstError) {
      const errorMessage =
        firstError instanceof Error ? firstError.message : 'Invalid JSON';

      this.logger.warn(
        `Brand search strategy parse failed, retrying: ${errorMessage}`,
      );

      rawResponse = await this.llmProvider.complete(
        buildBrandSearchStrategyCorrectionPrompt(rawResponse, errorMessage),
      );
      return parseBrandSearchStrategyPlan(rawResponse);
    }
  }

  async planLeadDiscovery(input: {
    brandName: string;
    website: string;
    domain: string;
    limit: number;
    scraperAllowlist: Array<{ id: string; name: string }>;
    instructions?: string;
  }): Promise<LeadDiscoveryPlan> {
    const prompt = buildPlanLeadDiscoveryPrompt({
      ...input,
      instructions:
        input.instructions?.trim() || DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS,
    });
    let rawResponse = await this.llmProvider.complete(prompt);

    try {
      return parseLeadDiscoveryPlan(rawResponse);
    } catch (firstError) {
      const errorMessage =
        firstError instanceof Error ? firstError.message : 'Invalid JSON';

      this.logger.warn(
        `Lead discovery plan parse failed, retrying: ${errorMessage}`,
      );

      rawResponse = await this.llmProvider.complete(
        buildLeadDiscoveryCorrectionPrompt(rawResponse, errorMessage),
      );
      return parseLeadDiscoveryPlan(rawResponse);
    }
  }
}
