import type { IbpCriteriaSnapshot } from '../../brand-discovery/interfaces/brand-source-provider.interface';
import type { WebSearchHit } from '../../brand-discovery/interfaces/web-search-provider.interface';

/**
 * Editable business instructions for Brand Discovery (PLAN search + SCORE).
 * Admins can customize this from Settings; schema/output contracts stay fixed.
 */
export const DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS = `You are a B2B brand discovery assistant for influencer marketing.

This prompt guides BOTH search-query planning and brand scoring for a specific influencer.

SEARCH STRATEGY (when planning Google queries):
- Lead with concrete product/service categories from the IBP + geography + company/brand language
- UGC / ambassador / affiliate are optional modifiers on at most one query — not the primary subject of every query
- Use influencer country when IBP markets are empty; otherwise prefer IBP markets
- Never put follower counts or engagement % into queries
- Never use listicle phrasing ("best brands", "top companies")
- Prefer distinct product/service categories over repeated collaboration-mode phrasing

SCORING (when ranking brands from search evidence):
- Prefer brands grounded in the provided evidence URLs over model prior knowledge
- Exclude sectors listed in excludedSectors
- Prefer product / DTC / commercial brands with a real corporate homepage (https://brand.com) — never store SERP deep links, UTM/tracking params, agency landings, listicles, or directories as website
- Put the SERP deep link in evidenceUrls; set website to the brand homepage origin only
- Prefer brands that sell products/services matching the IBP; admit agencies/platforms only when a real commercial opportunity is clear from the hits
- Align brand size expectations with the influencer's followers/engagement scale; omit brandSize when unknown — do not invent
- Score fit from 0–100 based on sector, market, brand size, and IBP criteria
- Explain fitReason briefly in business terms
- Do not invent emails, contacts, or brands without evidence
- Do not return more brands than the requested limit`;

/**
 * Fixed output contract — not editable from UI.
 */
const OUTPUT_CONTRACT = `Respond with ONLY valid JSON (no markdown outside the JSON) matching this exact schema:
{
  "brands": [
    {
      "name": "string",
      "website": "https://...",
      "sector": "string",
      "market": "string",
      "brandSize": "string",
      "score": 0-100,
      "fitReason": "string",
      "evidenceUrls": ["https://..."]
    }
  ]
}`;

/**
 * Expand IBP sector / niche tokens into concrete product/service category phrases.
 * Only expands from fields already present — does not invent unrelated markets.
 * Avoids bare sector+brands (e.g. "maternity brands") which SERP treats as too broad.
 */
function expandProductServiceCategories(
  ibp: IbpCriteriaSnapshot,
  niche?: string | null,
  niches?: string[] | null,
): string[] {
  const categories: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (
      trimmed &&
      !categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())
    ) {
      categories.push(trimmed);
    }
  };

  const expandFromText = (raw: string) => {
    const s = raw.trim().toLowerCase().replace(/_/g, ' ');
    if (!s) return;
    if (s.includes('matern') || s.includes('embaraz') || s.includes('prenatal')) {
      push('maternity apparel brands');
      push('breastfeeding product brands');
      push('baby care product companies');
      push('postpartum wellness services');
      return;
    }
    if (s.includes('entrepreneur') || s.includes('emprend') || s.includes('ceo')) {
      push('entrepreneurship education course brands');
      push('small business coaching services');
      push('solopreneur software companies');
      return;
    }
    if (
      s.includes('personal development') ||
      s.includes('mindset') ||
      s.includes('desarrollo personal')
    ) {
      push('personal development course brands');
      push('mindset coaching services');
      push('journaling wellness product brands');
      return;
    }
    if (s.includes('decor') || s.includes('home')) {
      push('home decor product brands');
      push('handmade home goods companies');
      return;
    }
    if (s.includes('fitness') || s.includes('gym')) {
      push('athletic apparel brands');
      push('home fitness equipment companies');
      return;
    }
    if (s.includes('beauty') || s.includes('skincare') || s.includes('cosmetic')) {
      push('skincare product brands');
      push('clean beauty companies');
      return;
    }
    // Unknown sector: keep a service + product phrasing, not bare "{sector} brands".
    push(`${s} product brands`);
    push(`${s} service companies`);
  };

  for (const sector of ibp.targetSectors) {
    expandFromText(sector);
  }

  for (const n of niches ?? []) {
    expandFromText(n);
  }
  if (niche?.trim()) {
    expandFromText(niche);
  }

  // Hashtag-only desirableCriteria are ignored for expansion (not commercial categories).
  for (const criterion of ibp.desirableCriteria ?? []) {
    const c = criterion.trim().toLowerCase();
    if (!c || c.includes('hashtag') || c.startsWith('#')) {
      continue;
    }
    if (c.length >= 8 && !c.includes('related to')) {
      expandFromText(criterion);
    }
  }

  return categories;
}

export function buildBrandDiscoveryQueries(
  ibp: IbpCriteriaSnapshot,
  influencerName: string,
  niche?: string | null,
  options?: { country?: string | null; niches?: string[] | null },
): string[] {
  const marketsFromIbp = ibp.markets.slice(0, 2).join(' ');
  const geo =
    marketsFromIbp.trim() ||
    options?.country?.trim() ||
    '';
  const marketA = ibp.markets[0]?.trim() || options?.country?.trim() || geo;
  const marketB = ibp.markets[1]?.trim() || marketA;
  const categories = expandProductServiceCategories(
    ibp,
    niche,
    options?.niches,
  );

  const cat0 = categories[0] || 'consumer product brands';
  const cat1 = categories[1] || categories[0] || 'specialty service companies';
  const cat2 = categories[2] || categories[0] || cat0;
  const cat3 = categories[3] || categories[1] || cat1;

  return [
    `${cat0} ${marketA}`.trim(),
    `${cat1} ${marketB}`.trim(),
    `${cat2} ${marketA}`.trim(),
    `${cat3} DTC ${marketB}`.trim(),
  ].filter((q) => q.length > 10);
}

export function buildScoreBrandsPrompt(input: {
  influencerName: string;
  niche?: string | null;
  ibp: IbpCriteriaSnapshot;
  limit: number;
  searchHits: WebSearchHit[];
  seedBrands?: Array<{
    name: string;
    website: string;
    sector?: string;
    market?: string;
    brandSize?: string;
    evidenceUrls?: string[];
  }>;
  instructions?: string;
}): string {
  const hitsJson = JSON.stringify(input.searchHits.slice(0, 40), null, 2);
  const seedsJson = JSON.stringify(input.seedBrands ?? [], null, 2);
  const ibpJson = JSON.stringify(input.ibp, null, 2);
  const trimmedInstructions =
    input.instructions?.trim() || DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS;

  return `${trimmedInstructions}

${OUTPUT_CONTRACT}

Influencer: ${input.influencerName}
Niche: ${input.niche ?? 'n/a'}

Ideal Brand Profile (confirmed by user):
${ibpJson}

Web search hits (evidence — prefer brands grounded in these URLs):
${hitsJson}

Structured seed brands from data providers (may be empty):
${seedsJson}

Return AT MOST ${input.limit} brands that fit the IBP.`;
}

export function buildBrandDiscoveryCorrectionPrompt(
  rawResponse: string,
  errorMessage: string,
): string {
  return `Your previous response was invalid JSON for brand discovery.

Error: ${errorMessage}

Previous response:
${rawResponse}

Return ONLY valid JSON matching:
{
  "brands": [
    {
      "name": "string",
      "website": "https://...",
      "sector": "string",
      "market": "string",
      "brandSize": "string",
      "score": 0-100,
      "fitReason": "string",
      "evidenceUrls": ["https://..."]
    }
  ]
}`;
}
