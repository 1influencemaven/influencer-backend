import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { BrandSourceProvider } from './interfaces/brand-source-provider.interface';

/** Brand Discovery Fase A: única fuente operativa (Bright Data SERP). */
export const BRAND_SOURCE_IDS = ['brightdata'] as const;
export type BrandSourceId = (typeof BRAND_SOURCE_IDS)[number];

export function isBrandSourceId(value: string): value is BrandSourceId {
  return (BRAND_SOURCE_IDS as readonly string[]).includes(value);
}

export type BrandSourcesResponse = {
  available: BrandSourceId[];
  default: BrandSourceId;
};

@Injectable()
export class BrandSourceRegistry {
  constructor(
    private readonly providers: Map<BrandSourceId, BrandSourceProvider>,
    private readonly _configService: ConfigService,
  ) {}

  listAvailable(): BrandSourceId[] {
    return BRAND_SOURCE_IDS.filter((id) => this.providers.has(id));
  }

  getDefault(): BrandSourceId {
    if (!this.providers.has('brightdata')) {
      throw new BadRequestException(
        'Bright Data is not configured. Set BRIGHTDATA_API_KEY for Brand Discovery.',
      );
    }
    return 'brightdata';
  }

  /**
   * Brand Discovery is Bright Data Search only. Legacy `tavily` source
   * values on old runs are ignored.
   */
  resolve(_source?: string | null): {
    id: BrandSourceId;
    provider: BrandSourceProvider;
  } {
    const provider = this.providers.get('brightdata');
    if (!provider) {
      throw new BadRequestException(
        'Bright Data is not configured. Set BRIGHTDATA_API_KEY for Brand Discovery.',
      );
    }
    return { id: 'brightdata', provider };
  }

  listSources(): BrandSourcesResponse {
    return {
      available: this.listAvailable(),
      default: this.getDefault(),
    };
  }
}

export function hasConfiguredApiKey(
  configService: ConfigService,
  key: string,
): boolean {
  const value = configService.get<string>(key);
  return Boolean(value?.trim());
}
