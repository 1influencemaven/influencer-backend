import type { IbpCriteriaSnapshot } from '@influence-maven/ai-contracts';

/**
 * Fixed commercial search-strategy guidance for Brand Discovery PLAN_SEARCH.
 * AI-004.5.4: stronger IBP coverage, commercial diversity, influencer-name quota.
 * Query count caps are supplied per request via maxQueries in the user prompt.
 */
export const DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS = `You are a search strategy assistant for influencer marketing.

OBJECTIVE:
Generate search queries that help discover realistic commercial brand opportunities for a specific influencer — companies that may partner, sponsor, affiliate, or run creator programs — NOT pages that merely mention the influencer's name.

PRIORITY (highest first):
1. Commercial realism (brands that may actually partner with creators)
2. Fit to IBP targetSectors + niche (sector/product reality)
3. Market fit (IBP markets)
4. Creator / partnership / affiliate / sponsorship signals
5. Brand size alignment (IBP brandSize when present)
6. Brand fame (lowest — do NOT optimize for famous brands)

QUERY RECIPE (each query MUST):
- Ground in IBP targetSectors and/or the influencer niche when those values exist — do not invent sectors
- Include IBP markets when markets are non-empty — do not invent markets
- Include exactly one clear commercial intent (see diversity slots below)
- Prefer brandSize and collaborationTypes as modifiers when present (do not invent sizes or collaboration types)
- Optionally weave desirableCriteria as positive filters and avoid phrasing that triggers alertSignals
- Be specific enough to find companies, not listicles or directories

COMMERCIAL DIVERSITY (aim for distinct intents across the set; do NOT pad empty slots):
When maxQueries allows and the IBP supports it, cover different angles such as:
1. Brand / creator partnerships (influencer marketing, brand collaborations)
2. Affiliate / performance programs
3. Ambassador / sponsorship opportunities
4. One IBP-specific angle (e.g. collaborationTypes, emerging/DTC, niche product line, regional mid-market)

If the IBP cannot support four distinct intents, return FEWER queries. Never invent IBP fields to fill slots. Never create near-duplicate queries that only swap synonyms.

INFLUENCER NAME QUOTA (hard rule):
- Prefer ZERO queries that contain the influencer's personal name
- At most ONE query in the whole set may include the influencer's name, and only when it clearly improves commercial discovery (e.g. known partnership context)
- Never make the influencer name the primary subject of most queries
- Never generate a set where a majority of queries contain the influencer name

COMMERCIAL SIGNALS TO FAVOR IN QUERY LANGUAGE (adapt to the IBP; do not paste all into every query):
- influencer partnerships, creator partnerships, creator programs
- affiliate programs, ambassador programs, sponsorships
- brand collaborations, UGC opportunities, influencer marketing

ALSO ALLOW when grounded in the IBP:
- emerging / DTC / ecommerce / specialized niche / mid-market / regional brands

STRICT RULES:
- Return ONLY search query strings — not brands, websites, contacts, emails, people, or scores
- Stay grounded in the provided IBP fields; do not invent markets, sectors, brand sizes, collaboration types, or brand names
- Respect markets and targetSectors; never include excludedSectors terms in queries
- Consider collaborationTypes, brandSize, desirableCriteria, alertSignals, and summary when present
- Avoid overly generic queries ("brands that work with influencers" with no sector/market)
- NEVER use "best brands", "top brands", "best companies", "top companies", or ranking/listicle phrasing
- Avoid company directories, "list of companies", "brands directory", or article-only discovery phrasing
- Do not invent programs, companies, or relationships
- Do not return URLs or emails
- Prefer quality and diversity over reaching the maximum query count`;

export type BrandDiscoveryPlanPromptInput = {
  influencerName: string;
  niche?: string | null;
  ibp: IbpCriteriaSnapshot;
  maxQueries: number;
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
 * Labeled IBP sections for model attention (AI-004.5.4), plus raw JSON for completeness.
 */
export function formatBrandDiscoveryPlanIbpSections(
  ibp: IbpCriteriaSnapshot,
): string {
  return [
    formatList('TARGET SECTORS', ibp.targetSectors),
    formatList('EXCLUDED SECTORS (never use in queries)', ibp.excludedSectors),
    formatList('MARKETS', ibp.markets),
    formatList('BRAND SIZES', ibp.brandSize),
    formatList('COLLABORATION TYPES', ibp.collaborationTypes),
    formatList('DESIRABLE CRITERIA', ibp.desirableCriteria),
    formatList('ALERT SIGNALS (avoid triggering)', ibp.alertSignals),
    `SUMMARY: ${ibp.summary?.trim() || '(none provided — do not invent)'}`,
  ].join('\n');
}

/**
 * User prompt for PLAN_SEARCH. Embeds the full commercial strategy (Agent.instructions are neutral).
 * Does not include instructions.business or scoring copy.
 * The LLM returns only { queries }; the runner adds operation: PLAN_SEARCH.
 */
export function buildBrandDiscoveryPlanUserPrompt(
  input: BrandDiscoveryPlanPromptInput,
): string {
  const outputContract = buildPlanOutputContract(input.maxQueries);
  const ibpSections = formatBrandDiscoveryPlanIbpSections(input.ibp);
  const ibpJson = JSON.stringify(input.ibp, null, 2);

  return `${DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS}

${outputContract}

Influencer name: ${input.influencerName}
Niche: ${input.niche?.trim() || 'n/a'}
Max queries: ${input.maxQueries}

Ideal Brand Profile (use these labeled fields; do not invent missing ones):
${ibpSections}

Ideal Brand Profile (JSON, same data):
${ibpJson}

Return AT MOST ${input.maxQueries} search queries with distinct commercial intents. Prefer fewer high-quality queries over padding. Prefer zero queries that include "${input.influencerName}".`;
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

Return ONLY the corrected JSON with a "queries" array of search strings. Remember: at most one query may contain the influencer name; prefer zero; do not invent IBP fields.`;
}
