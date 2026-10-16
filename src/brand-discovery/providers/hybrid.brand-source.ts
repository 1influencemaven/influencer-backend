import { Injectable } from '@nestjs/common';

import type {
  BrandDiscoverResult,
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

  async discover(context: BrandSourceContext): Promise<BrandDiscoverResult> {
    const half = Math.max(1, Math.ceil(context.limit / 2));

    const [tavilyResult, brightDataResult] = await Promise.all([
      this.tavilySource.discover({ ...context, limit: half }),
      this.brightDataSource.discover({ ...context, limit: half }),
    ]);

    const tavilyResults = tavilyResult.candidates;
    const brightDataResults = brightDataResult.candidates;

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

    const candidates = dedupeByDomain(merged).slice(
      0,
      context.limit,
    ) as RawBrandCandidate[];

    return { candidates, searchMetadata: null };
  }
}
