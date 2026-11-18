/**
 * Path ladder for FIND_AGENCY_EMAILS deterministic seed.
 * Agency-oriented commercial pages; does not alter brand COMMERCIAL_SEED_PATHS.
 */
export const AGENCY_COMMERCIAL_SEED_PATHS = [
  '/partnerships',
  '/partners',
  '/brand-partnerships',
  '/influencer-marketing',
  '/influencers',
  '/creators',
  '/creator-relations',
  '/talent',
  '/talent-partnerships',
  '/campaigns',
  '/campaign-management',
  '/collaborations',
  '/collabs',
  '/marketing',
  '/press',
  '/media',
  '/contact',
  '/contact-us',
  '/about',
  '/team',
  '/company',
] as const;

/**
 * site: SERP queries for agency commercial inboxes (RF-02 order, agency wording).
 */
export function buildAgencyCommercialSerpQueries(params: {
  agencyName: string;
  domain: string;
  niche?: string | null;
  niches?: string[];
  maxQueries?: number;
}): string[] {
  const domain = params.domain.trim().toLowerCase().replace(/^www\./, '');
  const name = params.agencyName
    .replace(/["\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!domain || !name) return [];

  const niche =
    params.niche?.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim() ||
    params.niches?.[0]?.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();

  const queries = [
    `site:${domain} (partnerships OR influencer OR creators OR talent) (contact OR email)`,
    `site:${domain} (campaign OR "brand partnerships" OR "creator relations") (contact OR email)`,
    niche
      ? `site:${domain} "${niche}" (influencer OR creator) agency contact email`
      : `"${name}" site:${domain} influencer marketing contact email`,
  ];

  const max = params.maxQueries ?? 2;
  return queries.slice(0, Math.max(0, max));
}
