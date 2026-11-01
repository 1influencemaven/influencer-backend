import type { IbpGenerationInput } from '@influence-maven/ai-contracts';

/**
 * Mirrors Nest DEFAULT_IBP_INSTRUCTIONS + OUTPUT_CONTRACT
 * (src/ai/prompts/generate-ibp.prompt.ts) without Prisma types.
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

export function buildIbpUserPrompt(
  input: IbpGenerationInput,
  businessInstructions: string,
): string {
  const instructions =
    businessInstructions.trim() || DEFAULT_IBP_INSTRUCTIONS;

  return `${instructions}

${OUTPUT_CONTRACT}

Influencer data:
${JSON.stringify(input.influencer, null, 2)}`;
}
