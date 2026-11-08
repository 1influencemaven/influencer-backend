import type { IbpCriteriaSnapshot } from '@influence-maven/ai-contracts';

/**
 * Default editable business instructions for Brand Discovery SCORE_CANDIDATES.
 * Mirrors Nest DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS (Settings scoring prompt).
 * Schema/output contract stays fixed and is not part of Settings.
 */
export const DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS = `You are a B2B brand discovery assistant for influencer marketing.

Given an Ideal Brand Profile (IBP) and web/search evidence, select brands that are a strong commercial fit for the influencer.

Business guidance:
- Prefer brands grounded in the provided evidence URLs
- Exclude sectors listed in excludedSectors
- Prefer brands with a real corporate website
- Score fit from 0–100 based on sector, market, brand size, and IBP criteria
- Explain fitReason briefly in business terms
- Do not invent emails, contacts, or brands without evidence
- Do not return more brands than the requested limit`;

/**
 * Fixed operational constraints for SCORE_CANDIDATES (not Settings-editable).
 * Complements business instructions without replacing them.
 * AI-004.5: SCORE may run with zero SERP hits — see Scenario A vs B.
 */
const SCORE_OPERATION_CONSTRAINTS = `Operation: SCORE_CANDIDATES

Fixed rules (always):
- Evaluate real commercial fit against the IBP (audience/niche signals, markets, brand size, collaborationTypes, desirableCriteria, alertSignals, summary, targetSectors, excludedSectors)
- Assign an integer score from 0 to 100 for each brand
- Justify each score with fitReason in business terms (compatibility rationale, not unverified commercial claims presented as facts)
- Return at most the requested limit of brands; prefer fewer strong fits over padding
- Avoid duplicate brands (same website/domain or clearly identical name+site)
- Every returned brand MUST include a real, reasonably trustworthy corporate website (https URL). If you cannot name a reliable website, omit that brand.
- Do not invent fictional companies, fabricated domains, fake URLs, emails, or contacts
- Do not invent evidenceUrls. Only include URLs that appear in the provided search hits or seed brand evidence. Otherwise use an empty evidenceUrls array.
- Do not emit evidenceStatus, VERIFIED, UNVERIFIED, or similar classification fields — NestJS classifies evidence later
- Do not treat keyword overlap with the niche alone as sufficient proof of fit
- Do not perform external searches or use tools
- Do not apply Nest hard-filters, domain dedupe persistence rules, or database lookups; return scored candidates only
- Do not center the entire result set on the influencer's personal name

Scenario A — search hits are present (non-empty Web search hits below):
- Analyze the provided hits and identify brands compatible with the IBP
- Prefer brands grounded in those hit URLs
- evidenceUrls must be subset of the provided hit/seed URLs for that brand
- Do not claim a brand was found in search if it was not supported by the hits

Scenario B — search hits are empty ([]):
- These fixed Scenario B rules OVERRIDE generic Settings/business copy when they conflict
- Continue using the full IBP context only
- You MAY use prior knowledge to propose real companies with reasonable IBP compatibility (sector, market, brandSize, collaborationTypes, desirableCriteria, alertSignals, summary)
- Returning ZERO brands is acceptable and preferred when you cannot name reliable, IBP-compatible companies — do NOT pad to fill the limit
- Prefer mid-market, DTC, regional, or specialized brands when that matches the IBP; do NOT bias toward famous global mega-brands
- Do NOT invent companies, domains, websites, programs, partnerships, affiliate/sponsorship/UGC schemes, or collaboration pages
- Leave evidenceUrls as [] for every brand (no external evidence was supplied) — never invent evidence URLs
- Do NOT assert that a brand seeks creators, runs an influencer/affiliate/ambassador program, or was found via SERP/web search
- fitReason must explain IBP compatibility only — not unverified commercial programs
- Still require a real, trustworthy corporate website for each brand; omit candidates without one
- Respect excludedSectors; do not invent markets or brandSize values outside the IBP`;

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
}

Constraints:
- brands: 0 to the requested limit entries
- score: number from 0 to 100
- fitReason: non-empty string
- evidenceUrls: array of URL strings (may be empty)
- no extra fields; do not include an "operation" field`;

const MAX_SEARCH_HITS_IN_PROMPT = 40;

export type BrandDiscoveryScoreSearchHit = {
  title: string;
  url: string;
  content?: string;
};

export type BrandDiscoveryScoreSeedBrand = {
  name: string;
  website: string;
  sector?: string;
  market?: string;
  brandSize?: string;
  evidenceUrls?: string[];
};

export type BrandDiscoveryScorePromptInput = {
  influencerName: string;
  niche?: string | null;
  ibp: IbpCriteriaSnapshot;
  limit: number;
  searchHits: BrandDiscoveryScoreSearchHit[];
  seedBrands?: BrandDiscoveryScoreSeedBrand[];
  /** From request.instructions.business; empty/whitespace → DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS */
  businessInstructions: string;
};

/**
 * User prompt for SCORE_CANDIDATES.
 * LLM returns only { brands }; the runner adds operation: SCORE_CANDIDATES.
 */
export function buildBrandDiscoveryScoreUserPrompt(
  input: BrandDiscoveryScorePromptInput,
): string {
  const business =
    input.businessInstructions.trim() || DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS;
  const ibpJson = JSON.stringify(input.ibp, null, 2);
  const hits = input.searchHits.slice(0, MAX_SEARCH_HITS_IN_PROMPT);
  const hitsJson = JSON.stringify(hits, null, 2);
  const serpScenario =
    hits.length === 0
      ? 'SERP scenario: B (no web search hits — IBP + optional prior knowledge; evidenceUrls must be []; zero brands OK; fixed Scenario B rules override Settings)'
      : `SERP scenario: A (${hits.length} web search hit(s) — ground brands in these URLs when possible)`;

  const seedSection =
    input.seedBrands && input.seedBrands.length > 0
      ? `

Structured seed brands from data providers:
${JSON.stringify(input.seedBrands, null, 2)}`
      : '';

  return `${business}

${SCORE_OPERATION_CONSTRAINTS}

${OUTPUT_CONTRACT}

Influencer: ${input.influencerName}
Niche: ${input.niche ?? 'n/a'}
Limit: ${input.limit}
${serpScenario}

Ideal Brand Profile (confirmed by user):
${ibpJson}

Web search hits (evidence — prefer brands grounded in these URLs when present):
${hitsJson}${seedSection}

Return AT MOST ${input.limit} brands that fit the IBP.`;
}

/**
 * Single-retry correction prompt for SCORE_CANDIDATES.
 */
export function buildBrandDiscoveryScoreCorrectionPrompt(params: {
  previousRaw: string;
  errorMessage: string;
  limit: number;
}): string {
  return `Your previous response was invalid JSON for brand discovery scoring.

Error: ${params.errorMessage}

Previous response:
${params.previousRaw}

${OUTPUT_CONTRACT}

Return ONLY the corrected JSON with a "brands" array of at most ${params.limit} scored brands.`;
}
