import type { IbpCriteriaSnapshot } from '@influence-maven/ai-contracts';

/**
 * Default editable business instructions for Brand Discovery (PLAN + SCORE).
 * Mirrors Nest DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS (Settings prompt).
 * Schema/output contracts stay fixed and are not part of Settings.
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
 * Fixed operational constraints for SCORE_CANDIDATES (not Settings-editable).
 * Complements business instructions without replacing them.
 * AI-004.5: SCORE may run with zero SERP hits — see Scenario A vs B.
 */
const SCORE_OPERATION_CONSTRAINTS = `Operation: SCORE_CANDIDATES

Fixed rules (always):
- Answer these questions before including a candidate:
  1) Is it a real company?
  2) Does it sell products or services?
  3) What does it sell concretely?
  4) Which market does it operate in?
  5) Who is its audience?
  6) Does that audience overlap the influencer's audience / IBP?
  7) Is there a reasonable collaboration opportunity (not just keyword overlap)?
- Textual keyword overlap with UGC, ambassador, DTC, or the niche is NOT enough evidence
- Classify the entity mentally before scoring:
  product brand | service company | agency | tech platform | marketplace | directory | publisher/media
- Do NOT return UGC marketplaces / creator job boards as if they were advertiser brands
- Do NOT return partnership/affiliate SaaS vendors solely because a hit teaches "how to run ambassador programs"
- Do NOT treat the publisher of a listicle/blog/PDF as the brand mentioned in that article
- Agencies and tech platforms MAY be returned only when a concrete commercial opportunity for THIS influencer is clear from the hits
- Commercial eligibility is independent of score: if ineligible, omit the candidate even if it would score high
- Evaluate real commercial fit against the IBP (audience/niche/content niches, markets, brand size, collaborationTypes, desirableCriteria, alertSignals, summary, targetSectors, excludedSectors)
- Assign an integer score from 0 to 100 for each eligible brand (fit quality only — not a substitute for eligibility)
- Justify each score with fitReason in business terms: what they sell, audience overlap, and why outreach is plausible
- Return at most the requested limit of brands; prefer fewer strong fits over padding; zero brands is OK
- Avoid duplicate brands (same website/domain or clearly identical name+site)
- Every returned brand MUST include a real, reasonably trustworthy corporate homepage as website (https://brand.com origin only — no path, query, or tracking). If you cannot name a reliable homepage, omit that brand.
- When a search hit is a deep page (landing, /es/…, article), use that URL only in evidenceUrls; website must still be the brand homepage origin
- Prefer product/service companies matching the IBP over influencer-marketing agencies, directories, or listicle sites found in the hits
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
- DIRECT vs SECONDARY sources (hard):
  - Prefer brands whose own corporate domain (or clear subdomain) appears in at least one hit URL that is a homepage, product, or company page — not a blog/listicle/how-to
  - Do NOT propose a company that is only named inside a third-party directory, org chart, news article, blog, PDF, listicle, or comparison page whose host is not that company's own site
  - Do NOT set website to the publisher of a "top DTC brands" / "how to create an ambassador program" article
  - Secondary mentions may be ignored; returning fewer brands is better than inventing homepage-only candidates from directory/article text
  - Agencies and creator platforms are allowed when the hit is on their own domain and a commercial opportunity for this influencer is clear
- Omit brandSize when you lack evidence for size; never invent "smb"/"startup" for well-known enterprises

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
  subNiche?: string | null;
  niches?: string[] | null;
  country?: string | null;
  language?: string | null;
  followers?: number | null;
  engagement?: number | null;
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

  const niches = (input.niches ?? []).map((n) => n.trim()).filter(Boolean);
  const profileLines = [
    `Name: ${input.influencerName}`,
    `Niche: ${input.niche?.trim() || 'n/a'}`,
    `Sub-niche: ${input.subNiche?.trim() || 'n/a'}`,
    `Content niches: ${niches.length > 0 ? niches.join('; ') : 'n/a'}`,
    `Country: ${input.country?.trim() || 'n/a'}`,
    `Language: ${input.language?.trim() || 'n/a'}`,
    `Followers: ${input.followers ?? 'n/a'}`,
    `Engagement %: ${input.engagement ?? 'n/a'}`,
  ].join('\n');

  return `${business}

${SCORE_OPERATION_CONSTRAINTS}

${OUTPUT_CONTRACT}

Influencer profile:
${profileLines}
Limit: ${input.limit}
${serpScenario}

Ideal Brand Profile (confirmed by user):
${ibpJson}

Web search hits (evidence — prefer brands grounded in these URLs when present):
${hitsJson}${seedSection}

Return AT MOST ${input.limit} commercially eligible brands that sell products/services aligned with the IBP. Prefer fewer (or zero) over marketplaces, publishers, or educational SaaS articles.`;
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
