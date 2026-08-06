/**
 * Editable business instructions for autonomous lead discovery.
 * Admins customize from Settings; JSON output contract stays fixed.
 */
export const DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS = `You are a B2B lead discovery assistant for influencer marketing outreach.

Given an approved brand, plan how to find commercial contacts who can respond to a collaboration proposal.

Business guidance:
- Prioritize influencer marketing, partnerships, sponsorships, brand/marketing managers, CMO, CEO/Founder
- Prefer contacts likely to answer a cold outreach email
- Prefer corporate emails on the brand domain when possible
- Deprioritize HR, support, legal, and generic inboxes (info@, hola@) as primary leads
- Suggest focused LinkedIn people search queries (include brand name + role)
- Only choose scrapers from the provided allowlist
- Do not invent emails or profile URLs
- Keep tavilyQueries between 3 and 6 items
- Keep scraperIds to 1 or 2 items from the allowlist`;

const OUTPUT_CONTRACT = `Respond with ONLY valid JSON (no markdown outside the JSON) matching this exact schema:
{
  "tavilyQueries": ["string"],
  "scraperIds": ["gd_..."],
  "priorityRoles": ["string"],
  "notes": "string"
}`;

export const DEFAULT_TAVILY_LEAD_QUERIES = (
  brandName: string,
): string[] => [
  `${brandName} CEO LinkedIn`,
  `${brandName} Founder LinkedIn`,
  `${brandName} CMO LinkedIn`,
  `${brandName} Marketing Manager LinkedIn`,
  `${brandName} Influencer Marketing LinkedIn`,
  `${brandName} Partnerships LinkedIn`,
];

export function buildPlanLeadDiscoveryPrompt(input: {
  brandName: string;
  website: string;
  domain: string;
  limit: number;
  scraperAllowlist: Array<{ id: string; name: string }>;
  instructions?: string;
}): string {
  const instructions =
    input.instructions?.trim() || DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS;
  const allowlistJson = JSON.stringify(input.scraperAllowlist, null, 2);

  return `${instructions}

Brand:
- name: ${input.brandName}
- website: ${input.website}
- domain: ${input.domain}
- maxContacts: ${input.limit}

Scraper allowlist (choose only from these ids):
${allowlistJson}

${OUTPUT_CONTRACT}`;
}

export function buildLeadDiscoveryCorrectionPrompt(
  previousRaw: string,
  errorMessage: string,
): string {
  return `Your previous response was invalid JSON for lead discovery planning.

Error: ${errorMessage}

Previous response:
${previousRaw}

${OUTPUT_CONTRACT}

Return ONLY the corrected JSON.`;
}
