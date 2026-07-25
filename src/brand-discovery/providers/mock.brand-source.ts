import { Injectable } from '@nestjs/common';

import type {
  BrandSourceContext,
  BrandSourceProvider,
  RawBrandCandidate,
} from '../interfaces/brand-source-provider.interface';
import { normalizeDomain } from '../utils/brand-domain.util';

@Injectable()
export class MockBrandSource implements BrandSourceProvider {
  readonly name = 'mock';

  async discover(context: BrandSourceContext): Promise<RawBrandCandidate[]> {
    const sector = context.ibp.targetSectors[0] ?? 'lifestyle';
    const market = context.ibp.markets[0] ?? 'Spain';

    return [
      {
        name: 'Demo Wellness Co',
        website: 'https://www.demowellness.example',
        domain: normalizeDomain('https://www.demowellness.example'),
        sector,
        market,
        brandSize: context.ibp.brandSize[0] ?? 'smb',
        score: 82,
        fitReason: `Mock brand matching ${sector} in ${market}`,
        source: this.name,
        evidenceUrls: ['https://www.demowellness.example'],
      },
      {
        name: 'FitLife Spain',
        website: 'https://www.fitlife.es',
        domain: normalizeDomain('https://www.fitlife.es'),
        sector,
        market,
        brandSize: 'mid_market',
        score: 76,
        fitReason: `Mock fitness brand for influencer ${context.influencerName}`,
        source: this.name,
        evidenceUrls: ['https://www.fitlife.es'],
      },
    ].slice(0, context.limit);
  }
}
