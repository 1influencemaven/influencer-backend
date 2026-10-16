import type { IbpCriteriaSnapshot } from '../../brand-discovery/interfaces/brand-source-provider.interface';

/**
 * Fixed instructions for Brand Discovery search-query planning.
 * Separate from Settings Brand Search Prompt (scoring only).
 */
export const DEFAULT_BRAND_SEARCH_STRATEGY_INSTRUCTIONS = `You are a search strategy assistant for influencer marketing.

OBJECTIVE:
Generate search queries that help discover realistic commercial brand opportunities for a specific influencer.

PRIORITY (highest first):
1. Commercial realism (brands that may actually partner with creators)
2. Specific influencer fit (sector, niche, collaboration style)
3. Market fit
4. Creator / partnership signals
5. Brand size alignment
6. Brand fame (lowest — do NOT optimize for famous brands)

QUALITY OVER QUANTITY:
- Prefer fewer, high-intent queries over many near-duplicates
- Maximum 4 queries; return fewer if the IBP does not support distinct intents
- Each query should have a differentiated commercial intent when context allows
  (e.g. creator partnerships, affiliate/ambassador, emerging/DTC, niche collaboration)
- Do NOT try to maximize search-result volume

COMMERCIAL SIGNALS TO FAVOR IN QUERY LANGUAGE:
- influencer partnerships, creator partnerships, creator programs
- affiliate programs, ambassador programs, sponsorships
- brand collaborations, UGC opportunities, influencer marketing

ALSO ALLOW:
- emerging / DTC / ecommerce / specialized niche / mid-market / regional brands

STRICT RULES:
- Return ONLY search query strings — not brands, websites, contacts, emails, people, or scores
- Stay grounded in the provided IBP fields; do not invent markets, sectors, or brand names
- Respect markets and targetSectors; avoid excludedSectors
- Consider collaborationTypes, brandSize, desirableCriteria, alertSignals, and summary
- Avoid overly generic queries
- NEVER use "best brands", "top brands", "best companies", "top companies", or ranking/listicle phrasing that pushes famous brands without commercial opportunity signals
- Do not center queries exclusively on the influencer's personal name
- Do not invent programs, companies, or relationships
- Do not return URLs or emails`;

const OUTPUT_CONTRACT = `Respond with ONLY valid JSON (no markdown outside the JSON) matching this exact schema:
{
  "queries": ["string"]
}

Constraints:
- queries: 1 to 4 strings
- each query: meaningful search text (about 10–200 characters)
- no extra fields`;

export function buildBrandSearchStrategyPrompt(input: {
  influencerName: string;
  niche?: string | null;
  ibp: IbpCriteriaSnapshot;
  maxQueries: number;
}): string {
  const ibpJson = JSON.stringify(input.ibp, null, 2);

  return `${DEFAULT_BRAND_SEARCH_STRATEGY_INSTRUCTIONS}

${OUTPUT_CONTRACT}

Influencer: ${input.influencerName}
Niche: ${input.niche ?? 'n/a'}
Max queries: ${input.maxQueries}

Ideal Brand Profile (confirmed by user):
${ibpJson}

Return AT MOST ${input.maxQueries} search queries. Prefer distinct commercial intents.`;
}

export function buildBrandSearchStrategyCorrectionPrompt(
  previousRaw: string,
  errorMessage: string,
): string {
  return `Your previous response was invalid JSON for brand search strategy.

Error: ${errorMessage}

Previous response:
${previousRaw}

${OUTPUT_CONTRACT}

Return ONLY the corrected JSON with a "queries" array of search strings.`;
}
