import type { IbpCriteriaSnapshot } from '@influence-maven/ai-contracts';

/**
 * Fixed commercial search-strategy guidance for Brand Discovery PLAN_SEARCH.
 * Product/service category discovery first; collaboration modes are optional modifiers.
 * Query count caps are supplied per request via maxQueries in the user prompt.
 */
export const DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS = `You are a search strategy assistant for influencer marketing.

OBJECTIVE:
Generate Google search queries that surface REAL companies selling SPECIFIC products or services relevant to this influencer's Ideal Brand Profile (IBP) — corporate brand sites, DTC shops, specialized service companies — that could be realistic commercial prospects.

UGC, brand ambassador, affiliate, and partnerships are collaboration MODES / opportunity signals, NOT company categories by themselves. Do not make those words the primary subject of every query.

STEP 0 — EXPAND ABSTRACT IBP INTO CONCRETE COMMERCIAL CATEGORIES (before writing queries):
- Read targetSectors, niche, sub-niche, content niches, summary, and useful desirableCriteria
- Convert abstract sectors into sellable product/service types grounded in THAT context
  (e.g. maternity → apparel, breastfeeding products, baby care, prenatal/postpartum services —
   entrepreneurship → education courses, small-business coaching, solopreneur tools —
   personal development → courses, coaching, related wellness products)
- Ignore hashtag-only or "Hashtags related to…" desirableCriteria when choosing categories
- Do NOT invent categories unrelated to the IBP; do NOT copy example phrases verbatim

PRIORITY (highest first):
1. Concrete product or service categories (not bare sector names)
2. Market / geography fit (IBP markets; else influencer country)
3. Companies that sell those products/services (brands, DTC, specialized services)
4. Optional collaboration-mode modifiers (creator, ambassador, affiliate, UGC) on AT MOST one query when it improves discovery
5. Brand size alignment (IBP brandSize when present) as a soft modifier — never invent sizes
6. Brand fame (lowest — do NOT optimize for famous airlines, mega-corps, or household names)

QUERY RECIPE (each query MUST):
- Combine: (CONCRETE product OR service category) + (market/geography) + (company/brand language such as "brands", "companies", "DTC", "products", or "services")
- The category must name what is sold (apparel, courses, coaching, baby care, skincare, software for solopreneurs, …) — not only the niche word
- Include IBP markets when markets are non-empty — do not invent markets; keep each query geographically coherent
- Prefer brandSize only as an optional soft modifier when present
- Be specific enough to find company websites, not listicles, directories, org charts, or news roundups
- Discover brands that SELL or are AVAILABLE in the market — including international / global ecommerce brands (e.g. Asian marketplaces) when relevant. Prefer phrasing like "brands selling in {market}", "international brands available in {market}", "products available in {market}"
- Do NOT restrict discovery to company HQ / country of incorporation. Avoid "headquartered in", "based in", "founded in {country}" unless that is the explicit research question (it is not)

CATEGORY DIVERSITY (when maxQueries >= 2):
- Each query should target a DIFFERENT concrete product/service category (or a clearly different market×category pair)
- Do NOT emit near-duplicates that only swap synonyms or word order
- Do NOT emit a set where most queries are about "brand ambassador", "UGC programs", or "influencer marketing" without a product/service category
- Do NOT emit multiple queries that only restate the same abstract sector (e.g. four variants of "entrepreneurship brands")
- At most ONE query in the set may lead with a collaboration-mode signal; the rest must lead with product/service categories
- Return fewer than maxQueries if the IBP cannot support distinct concrete categories. Never invent IBP fields to fill slots

INFLUENCER NAME QUOTA (hard rule):
- Prefer ZERO queries that contain the influencer's personal name
- At most ONE query in the whole set may include the influencer's name, and only when it clearly improves commercial discovery
- Never make the influencer name the primary subject of most queries

GOOD SHAPE (patterns only — derive categories from THIS influencer's IBP; do not copy these strings):
- "{concrete product category} brands selling in {market}"
- "{concrete service category} companies {market}"
- "{concrete product category} DTC {market}"
- "{concrete product category} international brands available in {market}"
- optionally one: "{concrete product category} {market} creator partnerships" or similar

BAD SHAPE (reject — too broad / mode-led / non-commercial):
- "entrepreneurship brands LATAM" (sector + market only)
- "maternity products United States" (sector + generic "products" + market)
- "personal development companies LATAM" (abstract sector only)
- "smb startups entrepreneurship United States" (size + sector, no sellable category)
- "personal development brand ambassador" (mode without product category)
- "startup maternity UGC programs" (mode-led, vague)
- "brands headquartered in United States" (HQ restriction — not commercial availability)
- "best brands …", directories, "list of companies", article-only phrasing

STRICT RULES:
- Return ONLY search query strings — not brands, websites, contacts, emails, people, or scores
- Stay grounded in the provided IBP fields; do not invent markets, sectors, brand sizes, collaboration types, or brand names
- Prefer influencer country when IBP markets are empty; when both exist, prefer IBP markets and keep queries geographically coherent
- Never put follower counts, engagement %, or "k followers" into queries — use those only as mental scale when choosing brand-size language
- Respect markets and targetSectors; never include excludedSectors terms in queries
- Consider collaborationTypes, brandSize, desirableCriteria, alertSignals, and summary when present
- Keep each query short and specific
- NEVER use "best brands", "top brands", "best companies", "top companies", or ranking/listicle phrasing
- Avoid company directories, "list of companies", "brands directory", org-chart sites, or article-only discovery phrasing
- Do not invent programs, companies, or relationships
- Do not return URLs or emails
- Prefer quality and distinct concrete categories over reaching the maximum query count`;

export type BrandDiscoveryPlanPromptInput = {
  influencerName: string;
  niche?: string | null;
  subNiche?: string | null;
  niches?: string[] | null;
  country?: string | null;
  language?: string | null;
  followers?: number | null;
  engagement?: number | null;
  ibp: IbpCriteriaSnapshot;
  maxQueries: number;
  /** Settings Brand Discovery prompt (business strategy for queries). */
  businessInstructions?: string;
};

function buildPlanOutputContract(maxQueries: number): string {
  return `Respond with ONLY valid JSON (no markdown outside the JSON) matching this exact schema:
{
  "queries": ["string"]
}

Constraints:
- queries: 1 to ${maxQueries} strings
- each query: meaningful search text (about 10–200 characters)
- at most one query may contain the influencer's personal name (prefer zero)
- no extra fields`;
}

function formatList(label: string, values: string[]): string {
  const cleaned = values.map((v) => v.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return `${label}: (none provided — do not invent)`;
  }
  return `${label}: ${cleaned.join('; ')}`;
}

/**
 * Labeled IBP sections for model attention, plus raw JSON for completeness.
 */
export function formatBrandDiscoveryPlanIbpSections(
  ibp: IbpCriteriaSnapshot,
): string {
  return [
    formatList('TARGET SECTORS', ibp.targetSectors),
    formatList('EXCLUDED SECTORS (never use in queries)', ibp.excludedSectors),
    formatList('MARKETS', ibp.markets),
    formatList('BRAND SIZES', ibp.brandSize),
    formatList(
      'COLLABORATION TYPES (optional modifiers — not primary query subjects)',
      ibp.collaborationTypes,
    ),
    formatList('DESIRABLE CRITERIA', ibp.desirableCriteria),
    formatList('ALERT SIGNALS (avoid triggering)', ibp.alertSignals),
    `SUMMARY: ${ibp.summary?.trim() || '(none provided — do not invent)'}`,
  ].join('\n');
}

function formatOptional(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return `${label}: (not provided — do not invent)`;
  }
  if (typeof value === 'string' && !value.trim()) {
    return `${label}: (not provided — do not invent)`;
  }
  return `${label}: ${typeof value === 'string' ? value.trim() : value}`;
}

function formatInfluencerProfileSection(input: BrandDiscoveryPlanPromptInput): string {
  const niches = (input.niches ?? []).map((n) => n.trim()).filter(Boolean);
  return [
    formatOptional('Name', input.influencerName),
    formatOptional('Niche', input.niche),
    formatOptional('Sub-niche', input.subNiche),
    niches.length > 0
      ? `Content niches: ${niches.join('; ')}`
      : 'Content niches: (not provided — do not invent)',
    formatOptional('Country / base location', input.country),
    formatOptional('Language', input.language),
    formatOptional('Followers', input.followers),
    formatOptional('Engagement %', input.engagement),
  ].join('\n');
}

/**
 * User prompt for PLAN_SEARCH.
 * Settings business instructions (when present) steer query strategy for this influencer;
 * operational constraints stay fixed in code. LLM returns only { queries }.
 */
export function buildBrandDiscoveryPlanUserPrompt(
  input: BrandDiscoveryPlanPromptInput,
): string {
  const outputContract = buildPlanOutputContract(input.maxQueries);
  const ibpSections = formatBrandDiscoveryPlanIbpSections(input.ibp);
  const ibpJson = JSON.stringify(input.ibp, null, 2);
  const business = input.businessInstructions?.trim() ?? '';
  const businessSection = business
    ? `SEARCH STRATEGY (Settings business instructions — apply when crafting queries for THIS influencer; ignore pure scoring-only lines if present):
${business}

`
    : '';

  return `${businessSection}${DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS}

${outputContract}

INFLUENCER PROFILE (from the product form — ground queries in this reality):
${formatInfluencerProfileSection(input)}
Max queries: ${input.maxQueries}

Ideal Brand Profile (use these labeled fields; do not invent missing ones):
${ibpSections}

Ideal Brand Profile (JSON, same data):
${ibpJson}

Return AT MOST ${input.maxQueries} search queries with DISTINCT CONCRETE product/service categories (and markets).
First expand abstract IBP sectors/niches into sellable categories; then write one query per category×market.
Ground geography in influencer country and/or IBP markets.
Do NOT emit sector+market-only queries (bad: "maternity products United States", "entrepreneurship brands LATAM").
Collaboration types are optional modifiers on at most one query — not the theme of the whole set.
Do NOT emit queries whose main subject is UGC, ambassador, affiliate, or partnerships without a concrete product/service category and company language (brands/companies/products/services/DTC).
Ignore hashtag-only desirableCriteria when inventing categories.
Use followers/engagement only to judge brand-size fit mentally — never as literal query tokens.
Prefer fewer high-quality concrete-category queries over padding. Prefer zero queries that include "${input.influencerName}".`;
}

/**
 * Single-retry correction prompt. Reuses the same maxQueries as the primary call.
 */
export function buildBrandDiscoveryPlanCorrectionPrompt(params: {
  previousRaw: string;
  errorMessage: string;
  maxQueries: number;
}): string {
  const outputContract = buildPlanOutputContract(params.maxQueries);

  return `Your previous response was invalid JSON for brand search strategy.

Error: ${params.errorMessage}

Previous response:
${params.previousRaw}

${outputContract}

Return ONLY the corrected JSON with a "queries" array of search strings. Remember: at most one query may contain the influencer name; prefer zero; lead with CONCRETE product/service categories (not bare sectors); each query a distinct category; do not invent IBP fields.`;
}
