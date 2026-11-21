/**
 * FIND_AGENCY_EMAILS — agency commercial inboxes (2C.4.4).
 * Brand FIND_BRAND_EMAILS prompt remains separate and unchanged.
 */
export const CONTACT_RESEARCH_FIND_AGENCY_EMAILS_INSTRUCTIONS = `You research commercial emails for ONE influencer marketing / talent agency.

Goal (agency inboxes only):
- Find partnership / influencer / creator / talent / campaign contact emails on the agency's own website.
- Prefer partnerships@, influencer@, creators@, collab@, talent@, campaigns@.
- Also accept marketing@ / press@ / media@ and general info@ / contact@ / hello@ when commercial pages are scarce.
- Exclude noreply@, support@, help@ (do not pursue those pages for outreach).

Tools:
- search_web: Google via Bright Data. Prefer site:{domain} commercial queries.
- open_page: open a URL on the agency domain only (Unlocker).
- extract_emails: pull literal emails from a page you already opened.

Hard rules:
- Never invent or guess emails. Only report emails returned by extract_emails (or already seeded).
- Stay on the agency domain for open_page.
- Do not re-open URLs already listed as seeded/opened.
- Do not use directories or listicles as proof that an email belongs to this agency.
- Do not attribute emails to named people in this run (mailbox discovery only).
- Respect remaining search/page budgets from the user message and tool responses.
- When done, stop calling tools and produce the structured result.`;

export function buildContactResearchFindAgencyEmailsUserPrompt(input: {
  agencyName: string;
  website: string;
  domain: string;
  niche?: string | null;
  niches?: string[];
  country?: string | null;
  markets?: string[];
  maxSerpQueries: number;
  maxPages: number;
  seededPages?: string[];
  seededEmailCount?: number;
  remainingSearches?: number;
  remainingPages?: number;
  preferredSeedUrls?: string[];
}): string {
  const nicheBits = [
    input.niche?.trim(),
    ...(input.niches ?? []).map((n) => n.trim()).filter(Boolean),
  ].filter(Boolean);
  const nicheLine =
    nicheBits.length > 0
      ? `Niche hints: ${[...new Set(nicheBits)].join(', ')}`
      : 'Niche hints: (none)';

  const marketBits = [
    input.country?.trim(),
    ...(input.markets ?? []).map((m) => m.trim()).filter(Boolean),
  ].filter(Boolean);
  const marketLine =
    marketBits.length > 0
      ? `Market / country hints: ${[...new Set(marketBits)].join(', ')}`
      : 'Market / country hints: (none)';

  const remainingSearches = input.remainingSearches ?? input.maxSerpQueries;
  const remainingPages = input.remainingPages ?? input.maxPages;
  const seededPages = input.seededPages ?? [];
  const seededEmailCount = input.seededEmailCount ?? 0;
  const preferred = input.preferredSeedUrls ?? [];

  const seedBlock =
    seededPages.length > 0
      ? `Deterministic seed already ran (path seed + optional commercial SERP):
- Opened pages: ${seededPages.join(', ')}
- Literal emails found so far: ${seededEmailCount}
Do not re-open those URLs. Use remaining budget for other on-domain commercial pages.`
      : `Deterministic seed found no openable pages. Prefer search_web then open_page on the agency domain.`;

  const preferredBlock =
    preferred.length > 0
      ? `Preferred URLs from prior agency evidence (already considered if on-domain):\n- ${preferred.join('\n- ')}`
      : '';

  return `Find commercial contact emails for this influencer / talent agency.

Agency name: ${input.agencyName}
Website: ${input.website}
Domain: ${input.domain}
${nicheLine}
${marketLine}
Budget remaining: ${remainingSearches} search_web calls, ${remainingPages} open_page calls
(total caps were ${input.maxSerpQueries} searches / ${input.maxPages} pages).

${seedBlock}
${preferredBlock}

Suggested query angles (adapt; do not paste blindly):
- site:${input.domain} partnerships OR creators OR influencer OR talent contact email
- site:${input.domain} campaign OR "brand partnerships" OR "creator relations" email
- ${input.agencyName} influencer marketing agency contact email site:${input.domain}

Target page types: partnerships, influencer marketing, creator relations, talent, campaigns, brand partnerships, contact, about.

Return structured FIND_AGENCY_EMAILS with every literal email extracted in this run (may be empty).`;
}
