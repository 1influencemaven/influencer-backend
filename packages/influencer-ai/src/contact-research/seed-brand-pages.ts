import type { BrightDataToolsClient } from '../brightdata/client';
import {
  evidenceSnippetAroundEmail,
  extractEmailsFromHtml,
} from '../brightdata/extract-emails';
import type { ContactResearchToolSession } from '../brightdata/session';

/** Max pages the seed itself may consume (leaves budget for LLM tools). */
export const CONTACT_EMAIL_SEED_MAX_PAGES = 3;

const CONTACT_PATHS = [
  '/contact',
  '/pages/contact',
  '/contact-us',
  '/pages/contact-us',
  '/about',
  '/pages/about',
] as const;

export type SeedBrandPagesResult = {
  attemptedUrls: string[];
  openedUrls: string[];
  failedUrls: string[];
  emailsFound: number;
};

function normalizeWebsiteUrl(website: string): string | null {
  const raw = website.trim();
  if (!raw) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    url.hash = '';
    url.search = '';
    // Prefer origin + pathname without trailing slash (except root)
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.origin}${path === '/' ? '/' : path}`;
  } catch {
    return null;
  }
}

function originOf(websiteUrl: string): string | null {
  try {
    return new URL(websiteUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Build homepage + contact-ish candidates on the brand domain.
 * Deduped; only URLs allowed by the session host rule.
 */
export function buildSeedCandidateUrls(
  session: ContactResearchToolSession,
): string[] {
  const website = normalizeWebsiteUrl(session.website);
  if (!website) return [];

  const origin = originOf(website);
  if (!origin) return [];

  const candidates: string[] = [website];
  for (const path of CONTACT_PATHS) {
    candidates.push(`${origin}${path}`);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of candidates) {
    const key = url.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) continue;
    if (!session.isAllowedUrl(url)) continue;
    seen.add(key);
    out.push(url.endsWith('/') && url !== `${origin}/` ? url.slice(0, -1) : url);
  }
  return out;
}

/**
 * Deterministic Unlocker open + literal email extract before the LLM loop.
 * Mutates `session` (pageCalls, pages, pageHtml, emails, lastError).
 */
export async function seedBrandPagesForEmailDiscovery(params: {
  client: BrightDataToolsClient;
  session: ContactResearchToolSession;
  /** Cap seed opens; also clamped by remaining session.maxPages. */
  maxSeedPages?: number;
}): Promise<SeedBrandPagesResult> {
  const { client, session } = params;
  const maxSeedPages = Math.max(
    0,
    Math.min(
      params.maxSeedPages ?? CONTACT_EMAIL_SEED_MAX_PAGES,
      session.maxPages - session.pageCalls,
    ),
  );

  const attemptedUrls: string[] = [];
  const openedUrls: string[] = [];
  const failedUrls: string[] = [];

  if (maxSeedPages <= 0) {
    return { attemptedUrls, openedUrls, failedUrls, emailsFound: 0 };
  }

  const candidates = buildSeedCandidateUrls(session).slice(0, maxSeedPages);

  for (const url of candidates) {
    if (session.pageCalls >= session.maxPages) break;

    attemptedUrls.push(url);
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

    session.pageHtml.set(url, page.html);
    openedUrls.push(url);

    const found = extractEmailsFromHtml(page.html);
    for (const email of found) {
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
    attemptedUrls,
    openedUrls,
    failedUrls,
    emailsFound: session.emails.size,
  };
}
