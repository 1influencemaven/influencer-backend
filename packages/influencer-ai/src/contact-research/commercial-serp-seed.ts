import type { BrightDataToolsClient } from '../brightdata/client';
import {
  evidenceSnippetAroundEmail,
  extractEmailsFromHtml,
} from '../brightdata/extract-emails';
import type { ContactResearchToolSession } from '../brightdata/session';
import { normalizeUrlKey } from '../brightdata/normalize-url-key';

/** Deterministic SERP queries within existing maxSerpQueries budget (RF-02). */
export const COMMERCIAL_SERP_SEED_MAX_QUERIES = 2;
/** Max new pages to open from SERP organics in this pre-LLM pass. */
export const COMMERCIAL_SERP_SEED_MAX_PAGES = 2;

export type CommercialSerpSeedResult = {
  queries: string[];
  serpCalls: number;
  openedUrls: string[];
  failedUrls: string[];
  emailsFoundDelta: number;
};

/**
 * Brand-scoped site: queries — not literal universal paste; niche adapts lightly.
 */
export function buildCommercialSerpQueries(params: {
  brandName: string;
  domain: string;
  niche?: string;
  maxQueries?: number;
}): string[] {
  const domain = params.domain.trim().toLowerCase().replace(/^www\./, '');
  const brand = params.brandName.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!domain || !brand) return [];

  const niche = params.niche?.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const queries = [
    `site:${domain} (partnerships OR creators OR influencer) (contact OR email)`,
    `site:${domain} (affiliate OR press OR media OR marketing) (contact OR email)`,
    niche
      ? `site:${domain} "${niche}" (collaboration OR partnership) email`
      : `${brand} site:${domain} influencer partnership contact email`,
  ];

  const max = params.maxQueries ?? COMMERCIAL_SERP_SEED_MAX_QUERIES;
  return queries.slice(0, Math.max(0, max));
}

/**
 * Run a few site: SERP queries and open new on-domain hits (deduped vs session.pages).
 * Uses remaining session SERP/page budgets — does not raise env caps.
 */
export async function seedCommercialSerpPages(params: {
  client: BrightDataToolsClient;
  session: ContactResearchToolSession;
  brandName: string;
  domain: string;
  niche?: string;
  maxQueries?: number;
  maxPages?: number;
  /** When set, use these queries instead of buildCommercialSerpQueries (agency ladder). */
  queries?: string[];
}): Promise<CommercialSerpSeedResult> {
  const { client, session } = params;
  const emailsBefore = session.emails.size;
  const maxQueries = Math.min(
    params.maxQueries ?? COMMERCIAL_SERP_SEED_MAX_QUERIES,
    Math.max(0, session.maxSerpQueries - session.serpCalls),
  );
  const maxPages = Math.min(
    params.maxPages ?? COMMERCIAL_SERP_SEED_MAX_PAGES,
    Math.max(0, session.maxPages - session.pageCalls),
  );

  const queries = (
    params.queries ??
    buildCommercialSerpQueries({
      brandName: params.brandName,
      domain: params.domain,
      niche: params.niche,
      maxQueries,
    })
  ).slice(0, maxQueries);

  const openedUrls: string[] = [];
  const failedUrls: string[] = [];
  const executedQueries: string[] = [];
  let serpCalls = 0;

  if (maxQueries <= 0 || queries.length === 0) {
    return {
      queries: [],
      serpCalls: 0,
      openedUrls,
      failedUrls,
      emailsFoundDelta: 0,
    };
  }

  const already = new Set(session.pages.map((u) => normalizeUrlKey(u)));
  const candidateUrls: string[] = [];

  for (const query of queries) {
    if (session.serpCalls >= session.maxSerpQueries) break;
    if (serpCalls >= maxQueries) break;

    session.serpCalls += 1;
    serpCalls += 1;
    session.queries.push(query);
    executedQueries.push(query);

    const serp = await client.searchWeb(query, 8);
    if (!serp.ok) {
      session.lastError =
        serp.brdError ?? serp.brdErrorCode ?? 'serp_failed';
      continue;
    }
    for (const hit of serp.organics) {
      if (!session.isAllowedUrl(hit.url)) continue;
      const key = normalizeUrlKey(hit.url);
      if (already.has(key)) {
        session.pageOriginCounts.duplicateUrlSkips += 1;
        continue;
      }
      already.add(key);
      candidateUrls.push(hit.url);
    }
  }

  for (const url of candidateUrls.slice(0, maxPages)) {
    if (session.pageCalls >= session.maxPages) break;

    session.pageOriginCounts.serpSeedPagesAttempted += 1;
    session.pageCalls += 1;
    session.pages.push(url);

    const page = await client.openPage(url);
    if (!page.ok || !page.html) {
      session.lastError =
        page.brdError ??
        (page.targetStatusCode
          ? `target_http_${page.targetStatusCode}`
          : page.brdErrorCode) ??
        'page_failed';
      failedUrls.push(url);
      continue;
    }

    session.setPageHtml(url, page.html);
    session.pageOriginCounts.serpSeedPagesDownloaded += 1;
    openedUrls.push(url);

    for (const email of extractEmailsFromHtml(page.html)) {
      if (!session.emails.has(email)) {
        session.emails.set(email, {
          email,
          sourceUrl: url,
          evidenceSnippet: evidenceSnippetAroundEmail(page.html, email),
        });
      }
    }
  }

  return {
    queries: executedQueries,
    serpCalls,
    openedUrls,
    failedUrls,
    emailsFoundDelta: session.emails.size - emailsBefore,
  };
}
