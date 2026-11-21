import type { AgencyDiscoveryInput } from '@influence-maven/ai-contracts';

export const AGENCY_DISCOVERY_DEFAULT_MAX_SERP_QUERIES = 4;
export const AGENCY_DISCOVERY_MIN_SERP_QUERIES = 2;

function cleanToken(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t && t.length >= 2 ? t : null;
}

function uniqueQueries(queries: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const normalized = q.replace(/\s+/g, ' ').trim();
    if (normalized.length < 10) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Deterministic SERP query ladder for Track 2C.
 * Uses only provided influencer/IBP fields — never invents country or niches.
 */
export function buildAgencySearchQueries(
  input: Pick<
    AgencyDiscoveryInput,
    | 'niche'
    | 'subNiche'
    | 'niches'
    | 'country'
    | 'markets'
    | 'ibpTargetSectors'
    | 'ibpMarkets'
    | 'maxSerpQueries'
  >,
): string[] {
  const max = Math.min(
    Math.max(
      input.maxSerpQueries ?? AGENCY_DISCOVERY_DEFAULT_MAX_SERP_QUERIES,
      AGENCY_DISCOVERY_MIN_SERP_QUERIES,
    ),
    10,
  );

  const niches = [
    ...(input.niches ?? []),
    input.niche,
    input.subNiche,
    ...(input.ibpTargetSectors ?? []),
  ]
    .map(cleanToken)
    .filter((v): v is string => Boolean(v));

  const primaryNiche = niches[0] ?? null;
  const secondaryNiche = niches.find((n) => n !== primaryNiche) ?? null;

  const markets = [...(input.markets ?? []), ...(input.ibpMarkets ?? [])]
    .map(cleanToken)
    .filter((v): v is string => Boolean(v));
  const primaryMarket = markets[0] ?? null;
  const country = cleanToken(input.country);

  const geo = country ?? primaryMarket;
  const drafts: string[] = [];

  if (primaryNiche && geo) {
    drafts.push(
      `influencer marketing agency "${primaryNiche}" brands creators ${geo}`,
    );
    drafts.push(
      `creator partnerships agency "${primaryNiche}" brand collaboration ${geo}`,
    );
  } else if (primaryNiche) {
    drafts.push(
      `influencer marketing agency "${primaryNiche}" connecting brands and creators`,
    );
    drafts.push(
      `"${primaryNiche}" influencer marketing agency brand campaigns partnerships`,
    );
  } else if (geo) {
    drafts.push(
      `influencer marketing agency connecting brands and creators ${geo}`,
    );
    drafts.push(
      `creator partnerships agency brand influencer collaboration ${geo}`,
    );
  } else {
    drafts.push(
      'influencer marketing agency connecting brands and creators partnerships',
    );
    drafts.push(
      'creator partnerships agency brand influencer collaboration campaigns',
    );
  }

  if (secondaryNiche && geo) {
    drafts.push(
      `influencer agency "${secondaryNiche}" brand campaigns contact ${geo}`,
    );
  } else if (secondaryNiche) {
    drafts.push(
      `influencer marketing agency "${secondaryNiche}" brands collaboration`,
    );
  }

  if (primaryMarket && country && primaryMarket.toLowerCase() !== country.toLowerCase()) {
    drafts.push(
      `influencer marketing agency brands creators ${primaryMarket} ${country}`,
    );
  }

  drafts.push(
    'influencer marketing agency "connect brands" "content creators" partnerships',
  );

  return uniqueQueries(drafts, max);
}
