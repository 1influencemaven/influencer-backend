import {
  instagramResearchEvidenceSchema,
  type IbpGenerationInput,
  type InstagramResearchEvidenceContract,
} from '@influence-maven/ai-contracts';

type InfluencerLike = {
  id: string;
  name: string;
  niche?: string | null;
  subNiche?: string | null;
  niches?: string[] | null;
  countries?: string[] | null;
  language?: string | null;
  followers?: number | null;
  /** Prisma Decimal / number / numeric string. */
  engagement?: { toString(): string } | number | string | null;
  instagram?: string | null;
  tiktok?: string | null;
  youtube?: string | null;
  email?: string | null;
  instagramResearchEvidence?: unknown;
};

/** Maps Prisma Influencer → ai-contracts IBP input (no secrets, no operational TM fields). */
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
    influencer.email ? 'hasPublicContactEmail=true' : null,
  ].filter(Boolean);

  const manualNiches = normalizeManualNiches(influencer.niches);
  const evidence = parseInstagramResearchEvidence(
    influencer.instagramResearchEvidence,
  );

  if (!evidence) {
    notesParts.push(
      influencer.instagramResearchEvidence == null
        ? 'instagramResearch=unavailable'
        : 'instagramResearch=invalid_or_unparseable',
    );
  }

  return {
    influencer: {
      id: influencer.id,
      name: influencer.name,
      niche: influencer.niche ?? undefined,
      platforms: platforms.length ? platforms : undefined,
      audienceSize: influencer.followers ?? undefined,
      audienceLocation: influencer.countries?.length
        ? influencer.countries.join(', ')
        : undefined,
      audienceLanguage: influencer.language ?? undefined,
      engagementRate: toEngagementRate(influencer.engagement),
      contentStyle: influencer.subNiche ?? influencer.niche ?? undefined,
      notes: notesParts.length ? notesParts.join('; ') : undefined,
    },
    manualNiches: manualNiches.length ? manualNiches : undefined,
    instagramResearchEvidence: evidence,
  };
}

function toEngagementRate(
  value: { toString(): string } | number | string | null | undefined,
): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : undefined;
}

export function parseInstagramResearchEvidence(
  raw: unknown,
): InstagramResearchEvidenceContract | null {
  if (raw == null) {
    return null;
  }
  const parsed = instagramResearchEvidenceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function normalizeManualNiches(niches: string[] | null | undefined): string[] {
  if (!Array.isArray(niches)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const niche of niches) {
    if (typeof niche !== 'string') {
      continue;
    }
    const trimmed = niche.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
