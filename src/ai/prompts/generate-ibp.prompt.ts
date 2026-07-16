import type { Influencer } from '../../generated/prisma/client';

/**
 * Editable business instructions for IBP generation.
 * Admins can customize this from Settings; schema/output contract stays fixed.
 */
export const DEFAULT_IBP_INSTRUCTIONS = `You are a commercial strategist for influencer marketing agencies.

Given the influencer data below, produce an Ideal Brand Profile (IBP): structured criteria describing which brands are a good commercial fit for this creator.

Business guidance:
- targetSectors: industries/sectors to pursue (e.g. "sportswear", "wellness apps")
- excludedSectors: sectors to avoid (e.g. "alcohol", "gambling")
- brandSize: use values like "startup", "smb", "mid_market", "enterprise"
- markets: geographic markets (e.g. "Spain", "LATAM")
- collaborationTypes: e.g. "product launch", "brand ambassador", "UGC"
- summary: 1-2 sentence human-readable description of the ideal brand
- alertSignals: red flags for bad brand fits
- desirableCriteria: nice-to-have criteria that improve fit but are not mandatory
- Use the influencer's country and language when inferring markets
- If data is missing, make reasonable inferences from available fields`;

/**
 * Fixed output contract — not editable from UI.
 * Ensures Zod validation and stable JSON shape for Brand Discovery.
 */
const OUTPUT_CONTRACT = `Respond with ONLY a valid JSON object (no markdown outside the JSON) matching this exact schema:
{
  "targetSectors": string[],
  "excludedSectors": string[],
  "brandSize": string[],
  "markets": string[],
  "collaborationTypes": string[],
  "summary": string,
  "alertSignals": string[],
  "desirableCriteria": string[]
}`;

export function buildGenerateIbpPrompt(
  influencer: Influencer,
  instructions: string = DEFAULT_IBP_INSTRUCTIONS,
): string {
  const influencerData = {
    name: influencer.name,
    instagram: influencer.instagram,
    tiktok: influencer.tiktok,
    youtube: influencer.youtube,
    country: influencer.country,
    language: influencer.language,
    niche: influencer.niche,
    subNiche: influencer.subNiche,
    followers: influencer.followers,
    engagement: influencer.engagement?.toString() ?? null,
    email: influencer.email,
    mediaKitUrl: influencer.mediaKitUrl,
  };

  const trimmedInstructions = instructions.trim() || DEFAULT_IBP_INSTRUCTIONS;

  return `${trimmedInstructions}

${OUTPUT_CONTRACT}

Influencer data:
${JSON.stringify(influencerData, null, 2)}`;
}

export function buildIbpCorrectionPrompt(
  previousResponse: string,
  errorMessage: string,
): string {
  return `Your previous response was invalid JSON or did not match the required schema.

Error: ${errorMessage}

Previous response:
${previousResponse}

Return ONLY a corrected JSON object with the required fields:
targetSectors, excludedSectors, brandSize, markets, collaborationTypes, summary, alertSignals, desirableCriteria`;
}
