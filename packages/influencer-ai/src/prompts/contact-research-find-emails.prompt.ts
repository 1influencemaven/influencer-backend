/**
 * Scoped from client "Outreach Automatico v2" PASO 2A only.
 * No roster, SalesHandy, LinkedIn people (2B), or agencies (2C) yet.
 */
export const CONTACT_RESEARCH_FIND_EMAILS_INSTRUCTIONS = `You research commercial emails for ONE approved brand.

Goal (2A — brand inboxes only):
- Find partnership / collaboration / press / affiliate style emails on the brand's own website.
- Prefer addresses like partnerships@, influencer@, collab@, affiliate@, press@, creators@.

Tools:
- search_web: Google via Bright Data. Craft niche + brand partnership queries.
- open_page: open a URL on the brand domain only (Unlocker).
- extract_emails: pull literal emails from a page you already opened.

Hard rules:
- Never invent or guess emails. Only report emails returned by extract_emails (or already seeded).
- Stay on the brand domain for open_page.
- Respect remaining search/page budgets from the user message and tool responses.
- LinkedIn people profiles and agencies are out of scope for this run.
- When done, stop calling tools and produce the structured result.`;

export function buildContactResearchFindEmailsUserPrompt(input: {
  brandName: string;
  website: string;
  domain: string;
  niche?: string;
  maxSerpQueries: number;
  maxPages: number;
  /** Pages already opened by deterministic seed (may be empty). */
  seededPages?: string[];
  /** Literal emails already extracted into session before the LLM loop. */
  seededEmailCount?: number;
  remainingSearches?: number;
  remainingPages?: number;
}): string {
  const nicheLine = input.niche?.trim()
    ? `Niche / category hint: ${input.niche.trim()}`
    : 'Niche / category hint: (none provided — infer lightly from brand name)';

  const remainingSearches =
    input.remainingSearches ?? input.maxSerpQueries;
  const remainingPages = input.remainingPages ?? input.maxPages;
  const seededPages = input.seededPages ?? [];
  const seededEmailCount = input.seededEmailCount ?? 0;

  const seedBlock =
    seededPages.length > 0
      ? `Deterministic seed already ran (Unlocker + literal extract):
- Opened pages: ${seededPages.join(', ')}
- Literal emails found so far: ${seededEmailCount}
Do not re-open those URLs unless needed. Use remaining budget to search or open other on-domain pages.`
      : `Deterministic seed found no openable pages. Prefer search_web then open_page on the brand domain.`;

  return `Find commercial contact emails for this approved brand.

Brand name: ${input.brandName}
Website: ${input.website}
Domain: ${input.domain}
${nicheLine}
Budget remaining: ${remainingSearches} search_web calls, ${remainingPages} open_page calls
(total caps were ${input.maxSerpQueries} searches / ${input.maxPages} pages).

${seedBlock}

Suggested query angles (adapt; do not paste blindly):
- "[niche] brand" influencer collaboration contact email partnerships
- site:${input.domain} partnerships OR creators OR affiliate OR press email
- ${input.brandName} influencer partnership contact email

Return structured FIND_BRAND_EMAILS with every literal email extracted in this run (may be empty).`;
}
