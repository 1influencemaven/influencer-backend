import type { IbpGenerationInput } from '@influence-maven/ai-contracts';

type InfluencerLike = {
  id: string;
  name: string;
  niche?: string | null;
  subNiche?: string | null;
  country?: string | null;
  language?: string | null;
  followers?: number | null;
  instagram?: string | null;
  tiktok?: string | null;
  youtube?: string | null;
  email?: string | null;
};

/** Maps Prisma Influencer → ai-contracts IBP input (no secrets). */
export function mapInfluencerToIbpInput(
  influencer: InfluencerLike,
): IbpGenerationInput {
  const platforms: string[] = [];
  if (influencer.instagram) platforms.push('instagram');
  if (influencer.tiktok) platforms.push('tiktok');
  if (influencer.youtube) platforms.push('youtube');

  const notesParts = [
    influencer.language ? `language=${influencer.language}` : null,
    influencer.subNiche ? `subNiche=${influencer.subNiche}` : null,
    influencer.email ? 'hasPublicEmail=true' : null,
  ].filter(Boolean);

  return {
    influencer: {
      id: influencer.id,
      name: influencer.name,
      niche: influencer.niche ?? undefined,
      platforms: platforms.length ? platforms : undefined,
      audienceSize: influencer.followers ?? undefined,
      audienceLocation: influencer.country ?? undefined,
      contentStyle: influencer.subNiche ?? influencer.niche ?? undefined,
      notes: notesParts.length ? notesParts.join('; ') : undefined,
    },
  };
}
