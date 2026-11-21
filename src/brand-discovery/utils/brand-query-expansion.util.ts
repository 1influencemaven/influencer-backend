import { expandSectorsToSubcategories } from './brand-sector-taxonomy.util';

/** Human-readable market labels for SERP queries (ISO-ish codes → English). */
const MARKET_LABELS: Record<string, string> = {
  us: 'United States',
  usa: 'United States',
  mx: 'Mexico',
  co: 'Colombia',
  ar: 'Argentina',
  es: 'Spain',
  latam: 'Latin America',
  eu: 'Europe',
  uk: 'United Kingdom',
  ca: 'Canada',
  br: 'Brazil',
  cl: 'Chile',
  pe: 'Peru',
};

export function marketLabel(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return MARKET_LABELS[value.toLowerCase()] ?? value;
}

export type BrandQueryExpansionInput = {
  /** IBP target sectors (abstract). */
  sectors: ReadonlyArray<string>;
  /** Influencer niches, used as extra sector seeds. */
  niches?: ReadonlyArray<string> | null;
  niche?: string | null;
  markets?: ReadonlyArray<string> | null;
  country?: string | null;
  /** Max queries returned (default 8). */
  max?: number;
};

/**
 * Query shapes aimed at brand sites (not listicles). Rotated per subcategory:
 *  0. company homepage        — "<sub> brand official site <market>"
 *  1. creator program page    — "<sub> brand creator program <market>"
 *  2. ambassador program page — "<sub> DTC brand ambassador program <market>"
 */
const PATTERNS: ReadonlyArray<(sub: string, market: string) => string> = [
  (sub, market) => `${sub} brand official site ${market}`,
  (sub, market) => `${sub} brand creator program ${market}`,
  (sub, market) => `${sub} DTC brand ambassador program ${market}`,
];

/**
 * Deterministic, concrete SERP queries derived from the IBP — used to top up
 * (or replace) an LLM plan that was mostly discarded by validation.
 */
export function buildExpandedBrandQueries(
  input: BrandQueryExpansionInput,
): string[] {
  const max = input.max ?? 8;
  // The IBP is what the brand side asked for: it decides the subcategories.
  // The influencer's own niches (which may include unrelated ones, e.g. a
  // beauty IBP for a talent that also posts about family) are only a fallback
  // when the IBP sectors yield nothing concrete.
  let subcategories = expandSectorsToSubcategories(input.sectors, max);
  if (subcategories.length === 0) {
    subcategories = expandSectorsToSubcategories(
      [...(input.niches ?? []), ...(input.niche ? [input.niche] : [])],
      max,
    );
  }
  if (subcategories.length === 0) return [];

  const markets = (input.markets ?? [])
    .map((m) => marketLabel(m))
    .filter((m): m is string => Boolean(m));
  const primaryMarket =
    markets[0] ?? marketLabel(input.country) ?? 'United States';

  return subcategories
    .slice(0, max)
    .map((sub, index) => PATTERNS[index % PATTERNS.length](sub, primaryMarket));
}
