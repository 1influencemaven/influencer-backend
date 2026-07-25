import type { IbpCriteriaSnapshot } from '../../brand-discovery/interfaces/brand-source-provider.interface';
import type { WebSearchHit } from '../../brand-discovery/interfaces/web-search-provider.interface';

/**
 * Editable business instructions for brand discovery scoring.
 * Admins can customize this from Settings; schema/output contract stays fixed.
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

export function buildBrandDiscoveryQueries(
  ibp: IbpCriteriaSnapshot,
  influencerName: string,
  niche?: string | null,
): string[] {
  const sectors = ibp.targetSectors.slice(0, 3).join(' ');
  const markets = ibp.markets.slice(0, 2).join(' ');
  const sizes = ibp.brandSize.slice(0, 2).join(' ');
  const nichePart = niche?.trim() ? niche : '';

  return [
    `${sectors} brands ${markets} influencer marketing ${nichePart}`.trim(),
    `${sectors} companies ${markets} ${sizes} sponsorship`.trim(),
    `best ${sectors} brands in ${markets} collaborating with influencers`.trim(),
    `${influencerName} ${sectors} brand partnerships ${markets}`.trim(),
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
