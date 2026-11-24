/**
 * Market compatibility between a candidate's `market` (free text from the LLM,
 * e.g. "United States", "U.S.", "North America") and the IBP's markets
 * (e.g. "US"). The previous substring-only check rejected "United States"
 * against "US", silently dropping every brand of a US-only IBP.
 */

const GLOBAL_MARKET_TOKENS = [
  'global',
  'worldwide',
  'international',
  'multinational',
  'multi-market',
  'multi market',
] as const;

/** Canonical market code -> accepted spellings (already lowercased, no dots). */
const MARKET_ALIASES: Readonly<Record<string, readonly string[]>> = {
  us: [
    'us',
    'usa',
    'u s',
    'u s a',
    'united states',
    'united states of america',
    'america',
    'estados unidos',
    'eeuu',
    'ee uu',
  ],
  ca: ['ca', 'canada', 'canadá'],
  mx: ['mx', 'mexico', 'méxico'],
  uk: ['uk', 'gb', 'united kingdom', 'great britain', 'britain', 'england', 'reino unido'],
  eu: ['eu', 'europe', 'european union', 'europa'],
  latam: [
    'latam',
    'latin america',
    'latinoamerica',
    'latinoamérica',
    'america latina',
    'américa latina',
  ],
  es: ['es', 'spain', 'españa', 'espana'],
};

/** Regions that contain several canonical markets. */
const REGION_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  'north america': ['us', 'ca', 'mx'],
  'norteamerica': ['us', 'ca', 'mx'],
  'norteamérica': ['us', 'ca', 'mx'],
};

function normalizeSpelling(value: string): string {
  return value
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookup(spelling: string): string[] {
  const out: string[] = [];
  for (const [code, names] of Object.entries(MARKET_ALIASES)) {
    if (names.includes(spelling)) out.push(code);
  }
  const region = REGION_MEMBERS[spelling];
  if (region) out.push(...region);
  return out;
}

/** Canonical market codes a free-text market refers to (may be empty). */
export function canonicalMarkets(value: string): Set<string> {
  const result = new Set<string>();
  const whole = normalizeSpelling(value);
  if (!whole) return result;
  for (const code of lookup(whole)) result.add(code);
  for (const part of whole.split(/[,/;|&]| and | y /)) {
    const spelling = part.trim();
    if (!spelling) continue;
    for (const code of lookup(spelling)) result.add(code);
  }
  return result;
}

export function isIbpCompatibleMarket(
  candidateMarket: string,
  ibpMarkets: ReadonlySet<string>,
): boolean {
  const market = candidateMarket.trim().toLowerCase();
  if (!market) return true;
  if (GLOBAL_MARKET_TOKENS.some((token) => market.includes(token))) return true;

  // Legacy substring rule (keeps previous behaviour for anything not aliased).
  if (
    [...ibpMarkets].some(
      (allowed) => market.includes(allowed) || allowed.includes(market),
    )
  ) {
    return true;
  }

  const candidate = canonicalMarkets(market);
  if (candidate.size === 0) return false;
  for (const allowed of ibpMarkets) {
    for (const code of canonicalMarkets(allowed)) {
      if (candidate.has(code)) return true;
    }
  }
  return false;
}
