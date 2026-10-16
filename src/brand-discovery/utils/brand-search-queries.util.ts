const DEFAULT_MIN_LENGTH = 10;
const DEFAULT_MAX_LENGTH = 200;

/** Phrases that tend to produce listicles / fame-biased SERP results. */
const LISTICLE_PHRASES = [
  'best brands',
  'top brands',
  'best companies',
  'top companies',
  'best brand',
  'top brand',
] as const;

export const BRAND_SEARCH_MAX_QUERIES = 4;

export type ValidateBrandSearchQueriesOptions = {
  maxQueries?: number;
  minLength?: number;
  maxLength?: number;
  excludedSectors?: string[];
};

/**
 * Deterministic post-LLM cleanup: trim, length, dedupe, excluded sectors,
 * listicle bait phrases, then cap at maxQueries.
 */
export function validateBrandSearchQueries(
  queries: string[],
  options: ValidateBrandSearchQueriesOptions = {},
): string[] {
  const maxQueries = options.maxQueries ?? BRAND_SEARCH_MAX_QUERIES;
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const excluded = (options.excludedSectors ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of queries) {
    if (result.length >= maxQueries) {
      break;
    }

    const trimmed = raw?.trim() ?? '';
    if (!trimmed) {
      continue;
    }
    if (trimmed.length < minLength || trimmed.length > maxLength) {
      continue;
    }

    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }

    if (LISTICLE_PHRASES.some((phrase) => lower.includes(phrase))) {
      continue;
    }

    if (excluded.some((sector) => lower.includes(sector))) {
      continue;
    }

    seen.add(lower);
    result.push(trimmed);
  }

  return result;
}
