import type { Influencer } from '../../generated/prisma/client';
import type { CommercialProfile } from '../interfaces/commercial-profile.interface';

export function buildMockCommercialProfile(
  influencer: Pick<Influencer, 'name' | 'niche' | 'subNiche' | 'country'>,
): CommercialProfile {
  const niche = influencer.niche ?? 'General';
  const country = influencer.country ?? 'Global';

  return {
    idealBrands: [
      `${niche} lifestyle brands`,
      `Premium ${niche.toLowerCase()} products in ${country}`,
    ],
    brandSize: ['smb', 'mid_market'],
    departments: ['marketing', 'brand', 'partnerships'],
    buyerPersonas: [
      {
        title: 'Marketing Manager',
        seniority: 'mid',
        responsibilities: ['influencer partnerships', 'campaign execution'],
      },
      {
        title: 'Brand Partnerships Lead',
        seniority: 'senior',
        responsibilities: ['creator selection', 'budget approval'],
      },
    ],
    futureMetadata: {
      generatedAt: new Date().toISOString(),
      source: 'mock',
      influencerName: influencer.name,
      subNiche: influencer.subNiche ?? null,
    },
  };
}
