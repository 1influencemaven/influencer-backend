/**
 * Default editable business instructions for Lead Discovery / Contact Research.
 * Mirrors Nest DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS (Settings → LeadDiscoveryPromptTemplate).
 *
 * Mandatory hard rules (RF-01 no invented emails/people, domain gates, budgets,
 * structured output schema) are NOT here — they live in immutable system prompts
 * and runtime guards and always take precedence over this text.
 */
export const DEFAULT_LEAD_DISCOVERY_BUSINESS_INSTRUCTIONS = `You are a B2B lead discovery assistant for influencer marketing outreach.

Given an approved brand, plan how to find commercial contacts who can respond to a collaboration proposal.

Business guidance:
- Prioritize Influencer Marketing Manager, Brand Partnerships, Creator Partnerships, sponsorships, CMO, CEO/Founder
- Prefer contacts likely to answer a cold outreach email
- Prefer corporate emails on the brand domain when possible
- Person-lead track: deprioritize HR, support, legal, and noreply inboxes as primary people
- Brand commercial inboxes (partnerships@, info@, press@) are handled by the website track — do not invent them here
- Suggest focused priority roles for LinkedIn people search (include brand context)
- Only choose scrapers from the provided allowlist
- Do not invent emails or profile URLs
- Keep priorityRoles between 3 and 6 items
- Keep scraperIds to 1 or 2 items from the allowlist`;

/**
 * Character cap for editable Lead Discovery business instructions injected into
 * worker prompts. Protects small-context local models (Ollama, e.g. num_ctx 8192)
 * while leaving ample room for tool responses and structured output on both
 * Ollama and Anthropic Claude.
 */
export const LEAD_DISCOVERY_INSTRUCTIONS_MAX_CHARS = 4000;

const TRUNCATION_SUFFIX = '\n[...truncated]';

export const LEAD_DISCOVERY_BUSINESS_SECTION_HEADER =
  'Business criteria / admin instructions (customizable; apply only when consistent with the mandatory hard rules — if there is any conflict, the mandatory hard rules ALWAYS win):';

/**
 * Resolves Settings Lead Discovery instructions with default fallback and
 * deterministic length cap (plain text, provider-agnostic).
 */
export function resolveLeadDiscoveryBusinessInstructions(
  businessInstructions?: string | null,
  maxChars: number = LEAD_DISCOVERY_INSTRUCTIONS_MAX_CHARS,
): string {
  const trimmed = businessInstructions?.trim() ?? '';
  const effective = trimmed || DEFAULT_LEAD_DISCOVERY_BUSINESS_INSTRUCTIONS;
  if (maxChars <= 0) {
    return '';
  }
  if (effective.length <= maxChars) {
    return effective;
  }
  if (maxChars <= TRUNCATION_SUFFIX.length) {
    return effective.slice(0, maxChars);
  }
  const sliceLen = maxChars - TRUNCATION_SUFFIX.length;
  return `${effective.slice(0, sliceLen).trimEnd()}${TRUNCATION_SUFFIX}`;
}

export function buildLeadDiscoveryBusinessSection(
  businessInstructions?: string | null,
  maxChars: number = LEAD_DISCOVERY_INSTRUCTIONS_MAX_CHARS,
): string {
  const resolved = resolveLeadDiscoveryBusinessInstructions(
    businessInstructions,
    maxChars,
  );
  return `${LEAD_DISCOVERY_BUSINESS_SECTION_HEADER}\n${resolved}`;
}
