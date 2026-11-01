import type { ContactResearchStateSnapshot } from '../schemas/contact-research-state.types';

export function buildContactResearchDecisionPrompt(
  state: ContactResearchStateSnapshot,
): string {
  return `You are the research orchestrator for commercial brand contact discovery.
Bright Data is the ONLY external search provider (SERP + Web Unlocker).
You must return ONE JSON decision for the next tool call. No markdown, no prose outside JSON.

Goal: find generic commercial emails (partnerships, influencers, collaborations, press, affiliate, contact) for the brand with literal evidence. Never invent emails.

Brand: ${state.brandName}
Website: ${state.website}
Domain: ${state.domain}
Market/geo hint: ${state.marketHint ?? 'unspecified'}

Limits (hard — do not exceed):
- maxSerpQueries: ${state.limits.maxSerpQueries} (used: ${state.serpQueriesUsed})
- maxPages: ${state.limits.maxPages} (used: ${state.pagesFetched})
- maxIterations remaining including this one: ${state.iterationsRemaining}

Emails found so far (normalized): ${JSON.stringify(state.emailsFound)}
SERP queries already run: ${JSON.stringify(state.executedQueries)}
URLs already fetched: ${JSON.stringify(state.fetchedUrls)}
Last tool observation (truncated): ${state.lastObservation ?? 'none'}

Allowed actions:
- search_web: needs "query" (SERP). Prefer commercial intents; avoid LinkedIn people hunting.
- fetch_page: needs "url" (must be http(s); prefer brand host or commercial pages).
- extract_emails: needs "url" already fetched in this research (backend uses deterministic literal extract).
- finalize_research: needs "finalize.outcome" RESULTS_FOUND | NO_MATCHES | PROVIDER_FAILURE and "reason".

Prefer finalize when enough evidence exists or limits are nearly exhausted.
If SERP/Unlocker failed repeatedly, finalize with PROVIDER_FAILURE (not NO_MATCHES).
If tools succeeded but no valid commercial emails, finalize NO_MATCHES.

Return JSON only:
{"action":"search_web"|"fetch_page"|"extract_emails"|"finalize_research","reason":"...","query":"...?","url":"...?","finalize":{"outcome":"...","summary":"..."}}`;
}

export function buildContactResearchDecisionCorrectionPrompt(
  rawResponse: string,
  errorMessage: string,
): string {
  return `Your previous JSON was invalid (${errorMessage}).
Fix and return ONLY valid JSON matching the contact research decision schema.
Previous output:
${rawResponse.slice(0, 2000)}`;
}
