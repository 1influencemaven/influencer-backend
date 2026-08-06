import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { LeadSourceProvider } from './interfaces/lead-source-provider.interface';
import { AI_BRIGHTDATA_PROVIDER_ID } from './providers/ai-plus-brightdata.lead-source';

/** Operative + reserved ids. Apollo reserved (ADR-0009). */
export const LEAD_SOURCE_IDS = [
  AI_BRIGHTDATA_PROVIDER_ID,
  'brightdata',
  'apollo',
] as const;
export type LeadSourceId = (typeof LEAD_SOURCE_IDS)[number];

export function isLeadSourceId(value: string): value is LeadSourceId {
  return (LEAD_SOURCE_IDS as readonly string[]).includes(value);
}

export type LeadSourcesResponse = {
  available: string[];
  default: string | null;
};

@Injectable()
export class LeadSourceRegistry {
  constructor(
    private readonly providers: Map<string, LeadSourceProvider>,
    private readonly _configService: ConfigService,
  ) {}

  listAvailable(): string[] {
    return [...this.providers.entries()]
      .filter(([, provider]) => provider.isConfigured())
      .map(([id]) => id);
  }

  getDefault(): string | null {
    const available = this.listAvailable();
    if (available.includes(AI_BRIGHTDATA_PROVIDER_ID)) {
      return AI_BRIGHTDATA_PROVIDER_ID;
    }
    if (available.includes('brightdata')) {
      return 'brightdata';
    }
    return available[0] ?? null;
  }

  resolve(providerId: string): {
    id: string;
    provider: LeadSourceProvider;
  } {
    if (!isLeadSourceId(providerId)) {
      throw new NotFoundException(`Unknown lead provider: ${providerId}`);
    }

    if (providerId === 'apollo') {
      throw new ServiceUnavailableException(
        'Apollo lead provider is reserved but not implemented yet. Set up Bright Data or wait for Apollo integration.',
      );
    }

    const provider = this.providers.get(providerId);
    if (!provider?.isConfigured()) {
      throw new ServiceUnavailableException(
        `Lead provider "${providerId}" is not configured`,
      );
    }

    return { id: providerId, provider };
  }

  listSources(): LeadSourcesResponse {
    return {
      available: this.listAvailable(),
      default: this.getDefault(),
    };
  }

  async listOptions(providerId: string) {
    const { id, provider } = this.resolve(providerId);
    const options = await provider.listOptions();
    return { providerId: id, options };
  }
}

export function hasConfiguredApiKey(
  configService: ConfigService,
  key: string,
): boolean {
  const value = configService.get<string>(key);
  return Boolean(value?.trim());
}

export function assertOptionIds(
  optionIds: string[] | undefined,
): asserts optionIds is string[] {
  if (!optionIds?.length) {
    throw new BadRequestException(
      'At least one provider option id is required',
    );
  }
}

export function isAutonomousLeadProvider(providerId: string): boolean {
  return providerId === AI_BRIGHTDATA_PROVIDER_ID;
}
