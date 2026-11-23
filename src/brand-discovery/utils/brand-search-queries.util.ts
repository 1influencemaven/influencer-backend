import { resolveNicheKeys } from './brand-sector-taxonomy.util';

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

/**
 * Collaboration / opportunity-mode tokens. Allowed on at most one query,
 * and never as the sole discovery axis of the set.
 */
const COLLABORATION_MODE_PATTERN =
  /\b(ugc|brand\s+ambassadors?|ambassadors?|affiliates?|partnerships?|influencer\s+marketing|creator\s+programs?|creator\s+collaborations?)\b/i;

/**
 * Signals that the query is still seeking companies/products, not only modes.
 * Do not treat "brand" inside "brand ambassador" as company-discovery language.
 */
const COMPANY_DISCOVERY_PATTERN =
  /\b(companies|company|products?|services?|dtc|shops?|stores?|vendors?|sellers?)\b|\bbrands?\b(?!\s+ambassadors?)/i;

/**
 * Cap for PLAN_SEARCH queries (serial SERP + inter-query delay).
 * 4 balances category/market diversity vs Bright Data rate-limit risk (was 2).
 */
export const BRAND_SEARCH_MAX_QUERIES = 4;

/** Max queries that may mention collaboration-mode tokens. */
export const BRAND_SEARCH_MAX_COLLABORATION_MODE_QUERIES = 1;

/** Jaccard threshold for “same commercial category” near-duplicates. */
export const BRAND_SEARCH_CATEGORY_NEAR_DUP_JACCARD = 0.72;

/**
 * Abstract niche/sector lemmas that alone (with market + brands/companies)
 * do not identify a sellable product/service category.
 */
const ABSTRACT_SECTOR_TOKENS = new Set([
  'maternity',
  'maternidad',
  'entrepreneurship',
  'entrepreneur',
  'entrepreneurs',
  'personal',
  'development',
  'mindset',
  'wellness',
  'lifestyle',
  'beauty',
  'fitness',
  'health',
  'tech',
  'technology',
  'business',
  'startup',
  'startups',
  'smb',
  'consumer',
  'industry',
  'sector',
  'niche',
  'latina',
  'latino',
  'latinas',
  'ceo',
  'mama',
  'mamá',
  'mother',
  'mothers',
  'mom',
  'moms',
  'women',
  'woman',
  'family',
  'families',
]);

/** Markets / geo / size / filler stripped before category signature. */
const STRUCTURAL_STOP_TOKENS = new Set([
  'latam',
  'latin',
  'america',
  'united',
  'states',
  'usa',
  'us',
  'spain',
  'españa',
  'espana',
  'mexico',
  'méxico',
  'europe',
  'eu',
  'global',
  'worldwide',
  'international',
  'brands',
  'brand',
  'companies',
  'company',
  'products',
  'product',
  'services',
  'service',
  'dtc',
  'shops',
  'shop',
  'stores',
  'store',
  'vendors',
  'vendor',
  'sellers',
  'seller',
  'smb',
  'startup',
  'startups',
  'mid',
  'market',
  'markets',
  'enterprise',
  'emerging',
  'small',
  'business',
  'ugc',
  'ambassador',
  'ambassadors',
  'affiliate',
  'affiliates',
  'partnership',
  'partnerships',
  'influencer',
  'influencers',
  'marketing',
  'creator',
  'creators',
  'program',
  'programs',
  'opportunities',
  'opportunity',
  'collaboration',
  'collaborations',
  'with',
  'and',
  'for',
  'the',
  'in',
  'of',
  'a',
  'an',
  'to',
]);

export type BrandSearchQueryDiscardReason =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'duplicate'
  | 'listicle'
  | 'excluded_sector'
  | 'mode_led'
  | 'mode_quota'
  | 'sector_generic'
  | 'near_duplicate_category'
  | 'off_ibp_sector';

export type BrandSearchQueryDiscard = {
  query: string;
  reason: BrandSearchQueryDiscardReason;
};

export type BrandSearchQueryValidationDiagnostics = {
  receivedCount: number;
  keptCount: number;
  discardedCount: number;
  discarded: BrandSearchQueryDiscard[];
  /** Category signatures kept (for observability). */
  keptCategorySignatures: string[];
};

export type ValidateBrandSearchQueriesOptions = {
  maxQueries?: number;
  minLength?: number;
  maxLength?: number;
  excludedSectors?: string[];
  /**
   * IBP target sectors. When they map to taxonomy niches, a query whose own
   * niche(s) are all outside them (e.g. "pet products" for a fashion/beauty IBP,
   * coming from the talent's personal niches) is discarded as `off_ibp_sector`.
   * Queries that map to no niche are kept.
   */
  targetSectors?: string[];
  /** Override collaboration-mode quota (default 1). */
  maxCollaborationModeQueries?: number;
  /** Override near-dup Jaccard (default 0.72). */
  categoryNearDupJaccard?: number;
};

export type ValidateBrandSearchQueriesResult = {
  queries: string[];
  diagnostics: BrandSearchQueryValidationDiagnostics;
};

export function queryMentionsCollaborationMode(query: string): boolean {
  return COLLABORATION_MODE_PATTERN.test(query);
}

export function queryHasCompanyDiscoveryLanguage(query: string): boolean {
  return COMPANY_DISCOVERY_PATTERN.test(query);
}

/**
 * True when collaboration mode dominates: mode tokens present and no
 * company/product discovery language (brands/companies/products/…).
 */
export function isCollaborationModeLedQuery(query: string): boolean {
  return (
    queryMentionsCollaborationMode(query) &&
    !queryHasCompanyDiscoveryLanguage(query)
  );
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Content tokens that describe the commercial category (markets / company
 * language / modes / size stripped).
 */
export function extractCategoryContentTokens(query: string): string[] {
  return tokenize(query).filter((token) => !STRUCTURAL_STOP_TOKENS.has(token));
}

/**
 * Stable signature for diversity checks (sorted unique content tokens).
 */
export function categorySignature(query: string): string {
  return [...new Set(extractCategoryContentTokens(query))].sort().join('|');
}

/**
 * Sector-generic: after stripping structure, only abstract niche/sector lemmas
 * remain (e.g. "maternity products United States", "entrepreneurship brands LATAM",
 * "smb startups entrepreneurship United States").
 * Rare legitimate niches with a non-abstract token (e.g. "mycelium packaging") pass.
 * Mode-led queries may also match; the pipeline records mode_led first when applicable.
 */
export function isSectorGenericQuery(query: string): boolean {
  const content = extractCategoryContentTokens(query);
  if (content.length === 0) {
    // e.g. "brands LATAM" / "DTC United States" with no category noun.
    return true;
  }
  return content.every((token) => ABSTRACT_SECTOR_TOKENS.has(token));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * True when two queries explore the same commercial category (order/synonym churn).
 */
export function areNearDuplicateCategoryQueries(
  left: string,
  right: string,
  threshold = BRAND_SEARCH_CATEGORY_NEAR_DUP_JACCARD,
): boolean {
  const a = new Set(extractCategoryContentTokens(left));
  const b = new Set(extractCategoryContentTokens(right));
  if (a.size === 0 && b.size === 0) {
    return true;
  }
  // Exact signature match after strip.
  if ([...a].sort().join('|') === [...b].sort().join('|')) {
    return true;
  }
  // One signature contained in the other with small extras.
  if (a.size > 0 && b.size > 0) {
    const smaller = a.size <= b.size ? a : b;
    const larger = a.size <= b.size ? b : a;
    let contained = true;
    for (const t of smaller) {
      if (!larger.has(t)) {
        contained = false;
        break;
      }
    }
    if (contained && smaller.size >= 1 && larger.size - smaller.size <= 1) {
      return true;
    }
  }
  return jaccard(a, b) >= threshold;
}

/**
 * Keep at most N queries that mention collaboration modes.
 * Prefer mode queries that still include company-discovery language.
 * Mode-led queries (mode without brands/companies/…) are dropped first.
 */
export function enforceCollaborationModeQueryQuota(
  queries: string[],
  maxModeQueries = BRAND_SEARCH_MAX_COLLABORATION_MODE_QUERIES,
): { kept: string[]; discarded: BrandSearchQueryDiscard[] } {
  const kept: string[] = [];
  const discarded: BrandSearchQueryDiscard[] = [];
  let modeKept = 0;

  for (const query of queries) {
    if (!queryMentionsCollaborationMode(query)) {
      kept.push(query);
      continue;
    }
    if (isCollaborationModeLedQuery(query)) {
      discarded.push({ query, reason: 'mode_led' });
      continue;
    }
    if (modeKept >= maxModeQueries) {
      discarded.push({ query, reason: 'mode_quota' });
      continue;
    }
    kept.push(query);
    modeKept += 1;
  }

  return { kept, discarded };
}

function emptyDiagnostics(
  receivedCount: number,
): BrandSearchQueryValidationDiagnostics {
  return {
    receivedCount,
    keptCount: 0,
    discardedCount: 0,
    discarded: [],
    keptCategorySignatures: [],
  };
}

/**
 * True when the query names only niches the IBP does not target. An IBP that
 * maps to no niche, or a query that maps to none, never triggers it.
 */
export function isOffIbpSectorQuery(
  query: string,
  ibpNicheKeys: ReadonlySet<string>,
): boolean {
  if (ibpNicheKeys.size === 0) return false;
  const queryKeys = resolveNicheKeys([query]).nicheKeys;
  return (
    queryKeys.length > 0 && !queryKeys.some((key) => ibpNicheKeys.has(key))
  );
}

/**
 * Deterministic post-LLM cleanup with observability:
 * trim, length, dedupe, listicle, excluded sectors, collaboration-mode quota,
 * sector-generic rejection, category near-dup rejection, then cap at maxQueries.
 */
export function validateBrandSearchQueriesWithDiagnostics(
  queries: string[],
  options: ValidateBrandSearchQueriesOptions = {},
): ValidateBrandSearchQueriesResult {
  const maxQueries = options.maxQueries ?? BRAND_SEARCH_MAX_QUERIES;
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const maxMode =
    options.maxCollaborationModeQueries ??
    BRAND_SEARCH_MAX_COLLABORATION_MODE_QUERIES;
  const nearDupThreshold =
    options.categoryNearDupJaccard ?? BRAND_SEARCH_CATEGORY_NEAR_DUP_JACCARD;
  const excluded = (options.excludedSectors ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const ibpNicheKeys = new Set(
    resolveNicheKeys(options.targetSectors ?? []).nicheKeys,
  );

  const discarded: BrandSearchQueryDiscard[] = [];
  const seen = new Set<string>();
  const preliminary: string[] = [];

  for (const raw of queries) {
    const trimmed = raw?.trim() ?? '';
    if (!trimmed) {
      discarded.push({ query: raw ?? '', reason: 'empty' });
      continue;
    }
    if (trimmed.length < minLength) {
      discarded.push({ query: trimmed, reason: 'too_short' });
      continue;
    }
    if (trimmed.length > maxLength) {
      discarded.push({ query: trimmed, reason: 'too_long' });
      continue;
    }

    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) {
      discarded.push({ query: trimmed, reason: 'duplicate' });
      continue;
    }

    if (LISTICLE_PHRASES.some((phrase) => lower.includes(phrase))) {
      discarded.push({ query: trimmed, reason: 'listicle' });
      continue;
    }

    if (excluded.some((sector) => lower.includes(sector))) {
      discarded.push({ query: trimmed, reason: 'excluded_sector' });
      continue;
    }

    if (isOffIbpSectorQuery(trimmed, ibpNicheKeys)) {
      discarded.push({ query: trimmed, reason: 'off_ibp_sector' });
      continue;
    }

    seen.add(lower);
    preliminary.push(trimmed);
  }

  const modePass = enforceCollaborationModeQueryQuota(preliminary, maxMode);
  discarded.push(...modePass.discarded);

  const afterGeneric: string[] = [];
  for (const query of modePass.kept) {
    if (isSectorGenericQuery(query)) {
      discarded.push({ query, reason: 'sector_generic' });
      continue;
    }
    afterGeneric.push(query);
  }

  const diverse: string[] = [];
  for (const query of afterGeneric) {
    const nearDup = diverse.find((kept) =>
      areNearDuplicateCategoryQueries(kept, query, nearDupThreshold),
    );
    if (nearDup) {
      discarded.push({ query, reason: 'near_duplicate_category' });
      continue;
    }
    diverse.push(query);
  }

  const kept = diverse.slice(0, maxQueries);
  // Queries truncated by maxQueries are not “discarded for quality” — omit.

  return {
    queries: kept,
    diagnostics: {
      receivedCount: queries.length,
      keptCount: kept.length,
      discardedCount: discarded.length,
      discarded,
      keptCategorySignatures: kept.map(categorySignature),
    },
  };
}

/**
 * Convenience wrapper — returns only the kept query strings.
 */
export function validateBrandSearchQueries(
  queries: string[],
  options: ValidateBrandSearchQueriesOptions = {},
): string[] {
  return validateBrandSearchQueriesWithDiagnostics(queries, options).queries;
}
