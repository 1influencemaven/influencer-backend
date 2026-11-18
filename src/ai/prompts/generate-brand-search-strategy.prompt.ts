import type { IbpCriteriaSnapshot } from '../../brand-discovery/interfaces/brand-source-provider.interface';

/**
 * Fixed instructions for Brand Discovery search-query planning (legacy Nest path).
 * Separate from Settings Brand Search Prompt (scoring only).
 * Kept aligned with Mastra PLAN_SEARCH product/service category strategy.
 */
export const DEFAULT_BRAND_SEARCH_STRATEGY_INSTRUCTIONS = `You are a search strategy assistant for influencer marketing.

OBJECTIVE:
Generate search queries that surface real companies selling products or services relevant to the influencer IBP.

UGC, ambassador, affiliate, and partnerships are collaboration MODES — optional modifiers, not the primary subject of every query.

PRIORITY (highest first):
1. Concrete product/service categories from IBP targetSectors, niche, summary
2. Market fit
3. Companies/brands that sell those products or services
4. Optional collaboration-mode modifier on at most one query
5. Brand size alignment
6. Brand fame (lowest)

QUALITY OVER QUANTITY:
- Prefer fewer, category-diverse queries over near-duplicates
- Respect the Max queries value in the user prompt
- Each query should target a different product/service category or market×category pair when context allows
- Do NOT maximize search-result volume with synonym swaps of UGC/ambassador phrasing

STRICT RULES:
- Return ONLY search query strings — not brands, websites, contacts, emails, people, or scores
- Stay grounded in the provided IBP fields; do not invent markets, sectors, or brand names
- Respect markets and targetSectors; avoid excludedSectors
- Consider collaborationTypes, brandSize, desirableCriteria, alertSignals, and summary
- Avoid overly generic mode-led queries ("personal development brand ambassador")
- NEVER use "best brands", "top brands", "best companies", "top companies", or ranking/listicle phrasing
- Avoid directories, org charts, and article-only discovery phrasing
- Do not center queries exclusively on the influencer's personal name
- Do not invent programs, companies, or relationships
- Do not return URLs or emails`;

function buildOutputContract(maxQueries: number): string {
  return `Respond with ONLY valid JSON (no markdown outside the JSON) matching this exact schema:
{
  "queries": ["string"]
}

Constraints:
- queries: 1 to ${maxQueries} strings
- each query: meaningful search text (about 10–200 characters)
- no extra fields`;
}

export function buildBrandSearchStrategyPrompt(input: {
  influencerName: string;
  niche?: string | null;
  ibp: IbpCriteriaSnapshot;
  maxQueries: number;
}): string {
  const ibpJson = JSON.stringify(input.ibp, null, 2);

  return `${DEFAULT_BRAND_SEARCH_STRATEGY_INSTRUCTIONS}

${buildOutputContract(input.maxQueries)}

Influencer: ${input.influencerName}
Niche: ${input.niche ?? 'n/a'}
Max queries: ${input.maxQueries}

Ideal Brand Profile (confirmed by user):
${ibpJson}

Return AT MOST ${input.maxQueries} search queries with distinct product/service categories.`;
}

export function buildBrandSearchStrategyCorrectionPrompt(
  previousRaw: string,
  errorMessage: string,
  maxQueries = 4,
): string {
  return `Your previous response was invalid JSON for brand search strategy.

Error: ${errorMessage}

Previous response:
${previousRaw}

${buildOutputContract(maxQueries)}

Return ONLY the corrected JSON with a "queries" array of search strings.`;
}
