export type SerpGeo = { gl: string; hl: string };

export type BrandDiscoveryGeoLensesMode = 'legacy' | 'v1';

export type SerpLensRole = 'local_home' | 'ibp_market' | 'ibp_region' | 'fallback';

export type SerpLens = {
  role: SerpLensRole;
  /** Human-readable market / region label (IBP token or country). */
  marketLabel: string;
  gl: string;
  hl: string;
  /** When role is ibp_region, the unresolved regional label (e.g. LATAM). */
  regionLabel?: string;
};

export type UnresolvedSerpRegion = {
  regionLabel: string;
  reason: 'no_countries_configured' | 'no_resolvable_countries';
};

export type SerpCallPlanItem = {
  query: string;
  lens: SerpLens;
  /** Market inferred from query text when deterministically matched. */
  queryTargetMarket: string | null;
  priority: number;
};

export type SerpCallOmission = {
  query: string;
  lens: SerpLens;
  queryTargetMarket: string | null;
  reason: 'budget_exhausted' | 'duplicate_query_lens' | 'market_lens_mismatch';
};

export type PlannedSerpCalls = {
  executed: SerpCallPlanItem[];
  omitted: SerpCallOmission[];
  plannedCount: number;
  maxCalls: number;
};

export type HitGeoAttribution = {
  domain: string;
  marketsSeen: string[];
  serpLenses: Array<{
    marketLabel: string;
    role: SerpLensRole;
    gl: string;
    hl: string;
  }>;
};

/**
 * Maps influencer country / IBP markets / language → Google SERP gl/hl.
 * Defaults remain us/en when nothing usable is provided.
 * Kept for BRAND_DISCOVERY_GEO_LENSES=legacy.
 */
const COUNTRY_TO_GL: Record<string, string> = {
  spain: 'es',
  españa: 'es',
  espana: 'es',
  mexico: 'mx',
  méxico: 'mx',
  colombia: 'co',
  argentina: 'ar',
  chile: 'cl',
  peru: 'pe',
  perú: 'pe',
  brazil: 'br',
  brasil: 'br',
  portugal: 'pt',
  france: 'fr',
  germany: 'de',
  italia: 'it',
  italy: 'it',
  'united kingdom': 'uk',
  uk: 'uk',
  england: 'uk',
  usa: 'us',
  'united states': 'us',
  'estados unidos': 'us',
  venezuela: 've',
  ecuador: 'ec',
  uruguay: 'uy',
  paraguay: 'py',
  bolivia: 'bo',
  'costa rica': 'cr',
  panama: 'pa',
  panamá: 'pa',
  guatemala: 'gt',
  'dominican republic': 'do',
  'republica dominicana': 'do',
  'república dominicana': 'do',
  miami: 'us',
  texas: 'us',
  california: 'us',
  georgia: 'us',
  houston: 'us',
  atlanta: 'us',
  utah: 'us',
  virginia: 'us',
  boston: 'us',
};

/** Legacy market map — includes LATAM→mx for resolveSerpGeo only. */
const LEGACY_MARKET_TO_GL: Record<string, string> = {
  spain: 'es',
  españa: 'es',
  latam: 'mx',
  'latin america': 'mx',
  europe: 'es',
  eu: 'es',
  usa: 'us',
  us: 'us',
  'united states': 'us',
  'estados unidos': 'us',
  global: 'us',
  worldwide: 'us',
};

/** Explicit country-like markets for v1 (no regional proxies). */
const EXPLICIT_MARKET_TO_GL: Record<string, string> = {
  spain: 'es',
  españa: 'es',
  espana: 'es',
  mexico: 'mx',
  méxico: 'mx',
  colombia: 'co',
  argentina: 'ar',
  chile: 'cl',
  peru: 'pe',
  perú: 'pe',
  brazil: 'br',
  brasil: 'br',
  portugal: 'pt',
  france: 'fr',
  germany: 'de',
  italy: 'it',
  italia: 'it',
  'united kingdom': 'uk',
  uk: 'uk',
  usa: 'us',
  us: 'us',
  'united states': 'us',
  'estados unidos': 'us',
  venezuela: 've',
  ecuador: 'ec',
};

const REGION_ALIASES: Record<string, string> = {
  latam: 'LATAM',
  'latin america': 'LATAM',
  'américa latina': 'LATAM',
  'america latina': 'LATAM',
  europe: 'Europe',
  eu: 'Europe',
  europa: 'Europe',
};

const GL_TO_HL: Record<string, string> = {
  us: 'en',
  uk: 'en',
  es: 'es',
  mx: 'es',
  co: 'es',
  ar: 'es',
  cl: 'es',
  pe: 'es',
  ve: 'es',
  ec: 'es',
  uy: 'es',
  py: 'es',
  bo: 'es',
  cr: 'es',
  pa: 'es',
  gt: 'es',
  do: 'es',
  br: 'pt',
  pt: 'pt',
  fr: 'fr',
  de: 'de',
  it: 'it',
};

const GL_CODE_RE = /^[a-z]{2}$/;

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function languageToHl(language?: string | null): string | undefined {
  if (!language?.trim()) return undefined;
  const lang = normalizeToken(language);
  if (lang.startsWith('es') || lang.includes('spanish') || lang.includes('castellano')) {
    return 'es';
  }
  if (lang.startsWith('pt') || lang.includes('portuguese')) {
    return 'pt';
  }
  if (lang.startsWith('fr')) return 'fr';
  if (lang.startsWith('de')) return 'de';
  if (lang.startsWith('it')) return 'it';
  if (lang.startsWith('en') || lang.includes('english')) return 'en';
  return undefined;
}

function lookupGl(
  token: string,
  table: Record<string, string>,
): string | undefined {
  const exact = table[token];
  if (exact) return exact;
  for (const [key, value] of Object.entries(table)) {
    // Prefer longer keys; avoid short false positives (e.g. "eu" in "united states").
    if (key.length < 3) {
      if (token === key) return value;
      continue;
    }
    if (token.includes(key) || key.includes(token)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Resolve SERP `gl` from Influencer.country.
 * Accepts ISO 3166-1 alpha-2 (canonical persistence, e.g. CO/US) and legacy
 * free-text country names for historical rows.
 */
function resolveCountryGl(country?: string | null): string | undefined {
  if (!country?.trim()) return undefined;
  const token = normalizeToken(country);
  // ISO alpha-2 stored by Talent Manager (P1c). Google uses `uk` for GB.
  if (GL_CODE_RE.test(token)) {
    if (token === 'gb') return 'uk';
    return token;
  }
  return lookupGl(token, COUNTRY_TO_GL);
}

function resolveExplicitMarketGl(market: string): string | undefined {
  return lookupGl(normalizeToken(market), EXPLICIT_MARKET_TO_GL);
}

function resolveRegionKey(market: string): string | undefined {
  return REGION_ALIASES[normalizeToken(market)];
}

function hlForGl(
  gl: string,
  influencerLanguage?: string | null,
): { hl: string; hlSource: 'market' | 'influencer' | 'default' } {
  const marketHl = GL_TO_HL[gl];
  if (marketHl) {
    return { hl: marketHl, hlSource: 'market' };
  }
  const fromInfluencer = languageToHl(influencerLanguage);
  if (fromInfluencer) {
    return { hl: fromInfluencer, hlSource: 'influencer' };
  }
  return { hl: 'en', hlSource: 'default' };
}

export function parseGeoLensesMode(
  raw?: string | null,
): BrandDiscoveryGeoLensesMode {
  const value = raw?.trim().toLowerCase();
  if (value === 'v1') return 'v1';
  return 'legacy';
}

/**
 * Parse region country config: comma-separated country names or ISO gl codes.
 * Empty / unset → no expansion (do not invent LATAM→mx).
 */
export function parseRegionCountryConfig(
  raw?: string | null,
): Array<{ label: string; gl: string }> {
  if (!raw?.trim()) return [];
  const out: Array<{ label: string; gl: string }> = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const token = normalizeToken(trimmed);
    let gl: string | undefined;
    let label = trimmed;
    if (GL_CODE_RE.test(token)) {
      gl = token;
      label = trimmed.toUpperCase() === trimmed ? trimmed : token;
    } else {
      gl = resolveCountryGl(trimmed) ?? resolveExplicitMarketGl(trimmed);
    }
    if (!gl || seen.has(gl)) continue;
    seen.add(gl);
    out.push({ label, gl });
  }
  return out;
}

export type BuildSerpLensesParams = {
  country?: string | null;
  language?: string | null;
  markets?: string[] | null;
  /** e.g. BRAND_DISCOVERY_REGION_LATAM_COUNTRIES=Mexico,Colombia,Argentina */
  regionCountryConfig?: Record<string, string | null | undefined>;
};

export type BuildSerpLensesResult = {
  lenses: SerpLens[];
  unresolvedRegions: UnresolvedSerpRegion[];
};

/**
 * P1b v1: prioritized SERP lenses (home + explicit markets + configured regions).
 * Does not implement intl_bridge. Does not map LATAM→mx unless configured.
 */
export function buildSerpLenses(
  params: BuildSerpLensesParams,
): BuildSerpLensesResult {
  const markets = (params.markets ?? []).map((m) => m.trim()).filter(Boolean);
  const unresolvedRegions: UnresolvedSerpRegion[] = [];
  const lenses: SerpLens[] = [];
  const byGl = new Map<string, SerpLens>();

  const upsert = (lens: SerpLens) => {
    const existing = byGl.get(lens.gl);
    if (!existing) {
      byGl.set(lens.gl, lens);
      lenses.push(lens);
      return;
    }
    // Prefer local_home role when deduping same gl; keep richer marketLabel.
    if (lens.role === 'local_home' && existing.role !== 'local_home') {
      existing.role = 'local_home';
      if (lens.marketLabel) existing.marketLabel = lens.marketLabel;
      return;
    }
    if (lens.role === 'ibp_market' && existing.role === 'ibp_region') {
      existing.role = 'ibp_market';
      existing.marketLabel = lens.marketLabel;
    }
  };

  const homeGl = resolveCountryGl(params.country);
  if (homeGl && params.country?.trim()) {
    const { hl } = hlForGl(homeGl, params.language);
    upsert({
      role: 'local_home',
      marketLabel: params.country.trim(),
      gl: homeGl,
      hl,
    });
  }

  for (const market of markets) {
    const regionKey = resolveRegionKey(market);
    if (regionKey) {
      const rawConfig = params.regionCountryConfig?.[regionKey];
      const countries = parseRegionCountryConfig(rawConfig);
      if (countries.length === 0) {
        unresolvedRegions.push({
          regionLabel: market,
          reason: 'no_countries_configured',
        });
        continue;
      }
      let added = 0;
      for (const country of countries) {
        const { hl } = hlForGl(country.gl, params.language);
        upsert({
          role: 'ibp_region',
          marketLabel: country.label,
          gl: country.gl,
          hl,
          regionLabel: market,
        });
        added += 1;
      }
      if (added === 0) {
        unresolvedRegions.push({
          regionLabel: market,
          reason: 'no_resolvable_countries',
        });
      }
      continue;
    }

    const gl = resolveExplicitMarketGl(market);
    if (!gl) {
      // Keep identity as unresolved explicit market — no invented gl.
      unresolvedRegions.push({
        regionLabel: market,
        reason: 'no_resolvable_countries',
      });
      continue;
    }
    const { hl } = hlForGl(gl, params.language);
    upsert({
      role: 'ibp_market',
      marketLabel: market,
      gl,
      hl,
    });
  }

  if (lenses.length === 0) {
    const { hl } = hlForGl('us', params.language);
    lenses.push({
      role: 'fallback',
      marketLabel: 'international_default',
      gl: 'us',
      hl,
    });
  }

  return { lenses, unresolvedRegions };
}

/**
 * Legacy single-geo resolver (country first, then markets including LATAM→mx).
 */
export function resolveSerpGeo(params: {
  country?: string | null;
  language?: string | null;
  markets?: string[] | null;
}): SerpGeo {
  const country = params.country ? normalizeToken(params.country) : '';
  const markets = (params.markets ?? []).map(normalizeToken).filter(Boolean);

  let gl: string | undefined;
  if (country) {
    gl = COUNTRY_TO_GL[country];
    if (!gl) {
      for (const [key, value] of Object.entries(COUNTRY_TO_GL)) {
        if (country.includes(key) || key.includes(country)) {
          gl = value;
          break;
        }
      }
    }
  }
  if (!gl) {
    for (const market of markets) {
      gl = LEGACY_MARKET_TO_GL[market];
      if (gl) break;
      for (const [key, value] of Object.entries(LEGACY_MARKET_TO_GL)) {
        if (key.length < 3) {
          if (market === key) {
            gl = value;
            break;
          }
          continue;
        }
        if (market.includes(key) || key.includes(market)) {
          gl = value;
          break;
        }
      }
      if (gl) break;
    }
  }

  const hlFromLang = languageToHl(params.language);
  const hl =
    hlFromLang ??
    (gl === 'es' || gl === 'mx' || gl === 'co' || gl === 'ar' || gl === 'cl' || gl === 'pe'
      ? 'es'
      : gl === 'br' || gl === 'pt'
        ? 'pt'
        : 'en');

  return { gl: gl ?? 'us', hl };
}

/**
 * Deterministic query ↔ IBP market binding.
 * Prefers longest matching market token; never binds "United States" to LATAM/MX.
 */
export function inferQueryTargetMarket(
  query: string,
  markets: string[] | null | undefined,
  country?: string | null,
): string | null {
  const q = normalizeToken(query);
  if (!q) return null;

  const candidates = [
    ...(markets ?? []).map((m) => m.trim()).filter(Boolean),
    ...(country?.trim() ? [country.trim()] : []),
  ];

  let best: { label: string; len: number } | null = null;
  for (const label of candidates) {
    const token = normalizeToken(label);
    if (token.length < 2) continue;
    if (!q.includes(token)) {
      // Common aliases
      if (token === 'united states' || token === 'estados unidos') {
        if (/\b(usa|u\.s\.a\.?|u\.s\.|estados unidos)\b/i.test(query)) {
          const len = label.length;
          if (!best || len > best.len) best = { label, len };
        }
      }
      continue;
    }
    const len = token.length;
    if (!best || len > best.len) best = { label, len };
  }
  return best?.label ?? null;
}

function lensMatchesMarket(lens: SerpLens, marketLabel: string | null): boolean {
  if (!marketLabel) return false;
  const target = normalizeToken(marketLabel);
  if (normalizeToken(lens.marketLabel) === target) return true;
  if (lens.regionLabel && normalizeToken(lens.regionLabel) === target) return true;
  // Explicit country market matches region child only via regionLabel, not gl guess.
  const targetGl = resolveExplicitMarketGl(marketLabel) ?? resolveCountryGl(marketLabel);
  if (targetGl && lens.gl === targetGl && lens.role !== 'ibp_region') {
    return true;
  }
  // Query targeting LATAM may run on region-expanded lenses.
  if (resolveRegionKey(marketLabel) && lens.role === 'ibp_region') {
    return (
      !!lens.regionLabel &&
      normalizeToken(lens.regionLabel) === normalizeToken(marketLabel)
    );
  }
  return false;
}

/**
 * Plan query×lens SERP calls under a hard budget. No intl_bridge.
 */
export function planSerpCalls(params: {
  queries: string[];
  lenses: SerpLens[];
  markets?: string[] | null;
  country?: string | null;
  maxCalls: number;
}): PlannedSerpCalls {
  const maxCalls = Math.max(0, Math.floor(params.maxCalls));
  const candidates: SerpCallPlanItem[] = [];
  const seen = new Set<string>();

  for (const query of params.queries) {
    const queryTargetMarket = inferQueryTargetMarket(
      query,
      params.markets,
      params.country,
    );
    for (const lens of params.lenses) {
      const key = `${query}::${lens.gl}::${lens.hl}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let priority = 100;
      if (lens.role === 'local_home') priority = 10;
      else if (lensMatchesMarket(lens, queryTargetMarket)) priority = 20;
      else if (lens.role === 'ibp_market') priority = 40;
      else if (lens.role === 'ibp_region') priority = 50;
      else priority = 80;

      // Prefer matching market tightly: demote mismatched explicit binds.
      if (
        queryTargetMarket &&
        !lensMatchesMarket(lens, queryTargetMarket) &&
        resolveExplicitMarketGl(queryTargetMarket)
      ) {
        // US query must not run only on mx — skip mismatched country lenses.
        priority = 1000;
      }

      candidates.push({ query, lens, queryTargetMarket, priority });
    }
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.query.localeCompare(b.query);
  });

  const executable = candidates.filter((c) => c.priority < 1000);
  const skippedMismatch = candidates.filter((c) => c.priority >= 1000);

  const executed = executable.slice(0, maxCalls);
  const omitted: SerpCallOmission[] = [
    ...executable.slice(maxCalls).map((c) => ({
      query: c.query,
      lens: c.lens,
      queryTargetMarket: c.queryTargetMarket,
      reason: 'budget_exhausted' as const,
    })),
    ...skippedMismatch.map((c) => ({
      query: c.query,
      lens: c.lens,
      queryTargetMarket: c.queryTargetMarket,
      reason: 'market_lens_mismatch' as const,
    })),
  ];

  return {
    executed,
    omitted,
    plannedCount: executable.length + skippedMismatch.length,
    maxCalls,
  };
}

/** Short SERP retry when the planned query returns empty_body / zero organics. */
export function buildSimplifiedSerpQuery(params: {
  niche?: string | null;
  subNiche?: string | null;
  country?: string | null;
  markets?: string[] | null;
}): string | null {
  const niche = params.subNiche?.trim() || params.niche?.trim() || '';
  const geo =
    params.markets?.find((m) => m.trim() && !/^global$/i.test(m.trim()))?.trim() ||
    params.country?.trim() ||
    '';
  if (!niche && !geo) {
    return null;
  }
  // Prefer commercial "selling in {market}" over HQ / partnership-only phrasing (P1b).
  const category = niche || params.markets?.[0]?.trim() || 'consumer product brands';
  const market = geo || 'market';
  const query = `${category} brands selling in ${market}`
    .replace(/\s+/g, ' ')
    .trim();
  return query.length >= 10 ? query : null;
}

export function mergeHitGeoAttributions(
  rows: Array<{
    domain: string;
    marketLabel: string;
    role: SerpLensRole;
    gl: string;
    hl: string;
  }>,
): HitGeoAttribution[] {
  const byDomain = new Map<string, HitGeoAttribution>();
  for (const row of rows) {
    if (!row.domain) continue;
    let entry = byDomain.get(row.domain);
    if (!entry) {
      entry = { domain: row.domain, marketsSeen: [], serpLenses: [] };
      byDomain.set(row.domain, entry);
    }
    if (!entry.marketsSeen.includes(row.marketLabel)) {
      entry.marketsSeen.push(row.marketLabel);
    }
    const lensKey = `${row.gl}|${row.hl}|${row.role}|${row.marketLabel}`;
    if (
      !entry.serpLenses.some(
        (l) =>
          `${l.gl}|${l.hl}|${l.role}|${l.marketLabel}` === lensKey,
      )
    ) {
      entry.serpLenses.push({
        marketLabel: row.marketLabel,
        role: row.role,
        gl: row.gl,
        hl: row.hl,
      });
    }
  }
  return [...byDomain.values()];
}
