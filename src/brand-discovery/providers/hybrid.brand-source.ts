import { Injectable } from '@nestjs/common';

import type {
  BrandSourceContext,
  BrandSourceProvider,
  RawBrandCandidate,
} from '../interfaces/brand-source-provider.interface';
import { dedupeByDomain } from '../utils/brand-domain.util';

@Injectable()
export class HybridBrandSource implements BrandSourceProvider {
  readonly name = 'hybrid';

  constructor(
    private readonly tavilySource: BrandSourceProvider,
    private readonly brightDataSource: BrandSourceProvider,
  ) {}

  async discover(context: BrandSourceContext): Promise<RawBrandCandidate[]> {
    const half = Math.max(1, Math.ceil(context.limit / 2));

    const [tavilyResults, brightDataResults] = await Promise.all([
      this.tavilySource.discover({ ...context, limit: half }),
      this.brightDataSource.discover({ ...context, limit: half }),
    ]);

    const merged = [
      ...brightDataResults.map((item) => ({
        ...item,
        source: this.name,
      })),
      ...tavilyResults.map((item) => ({
        ...item,
        source: this.name,
        evidenceUrls: [
          ...new Set([
            ...item.evidenceUrls,
            ...(brightDataResults.find((b) => b.domain === item.domain)
              ?.evidenceUrls ?? []),
          ]),
        ],
      })),
    ];

    return dedupeByDomain(merged).slice(0, context.limit) as RawBrandCandidate[];
  }
}
