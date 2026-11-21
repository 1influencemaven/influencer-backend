import type { BrightDataToolsClient } from '../brightdata/client';
import {
  evidenceSnippetAroundEmail,
  extractEmailsFromHtml,
} from '../brightdata/extract-emails';
import { normalizeUrlKey } from '../brightdata/normalize-url-key';
import type { ContactResearchToolSession } from '../brightdata/session';

export { normalizeUrlKey } from '../brightdata/normalize-url-key';

/** Max pages the seed itself may consume (leaves budget for LLM tools). RF-02: unchanged. */
export const CONTACT_EMAIL_SEED_MAX_PAGES = 3;

/**
 * RF-02 priority path hints (not required to exist).
 * Order: commercial collab → affiliate → press/marketing → contact → about/corp.
 */
export const COMMERCIAL_SEED_PATHS = [
  '/partnerships',
  '/partners',
  '/pages/partnerships',
  '/collaborations',
  '/collabs',
  '/creators',
  '/influencers',
  '/creator-program',
  '/brand-ambassadors',
  '/affiliate',
  '/affiliates',
  '/affiliate-program',
  '/pages/affiliate',
  '/marketing',
  '/press',
  '/media',
  '/newsroom',
  '/contact',
  '/pages/contact',
  '/contact-us',
  '/pages/contact-us',
  '/about',
  '/pages/about',
  '/company',
  '/team',
  '/business',
  '/corporate',
] as const;

export type SeedBrandPagesResult = {
  attemptedUrls: string[];
  openedUrls: string[];
  failedUrls: string[];
  emailsFound: number;
  /** How many preferred (e.g. Brand Discovery) URLs were among attempts. */
  preferredAttempted: number;
};

function normalizeWebsiteUrl(website: string): string | null {
  const raw = website.trim();
  if (!raw) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    url.hash = '';
    url.search = '';
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

function toCandidateUrl(raw: string): string | null {
  try {
    const withProtocol = /^https?:\/\//i.test(raw.trim())
      ? raw.trim()
      : `https://${raw.trim()}`;
    const parsed = new URL(withProtocol);
    parsed.hash = '';
    parsed.search = '';
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${path === '/' ? '/' : path}`;
  } catch {
    return null;
  }
}

/**
 * Build prioritized Unlocker candidates on the brand domain (RF-02).
 * Order: preferred on-domain URLs → commercial paths → website homepage.
 */
export function buildSeedCandidateUrls(
  session: ContactResearchToolSession,
  preferredUrls: string[] = [],
  /** Override path ladder (default: brand COMMERCIAL_SEED_PATHS). */
  seedPaths: readonly string[] = COMMERCIAL_SEED_PATHS,
): string[] {
  const website = normalizeWebsiteUrl(session.website);
  if (!website) return [];

  const origin = originOf(website);
  if (!origin) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const url = toCandidateUrl(raw);
    if (!url) return;
    const key = normalizeUrlKey(url);
    if (seen.has(key)) return;
    if (!session.isAllowedUrl(url)) return;
    seen.add(key);
    out.push(url);
  };

  for (const preferred of preferredUrls) {
    push(preferred);
  }
  for (const path of seedPaths) {
    push(`${origin}${path}`);
  }
  push(website);

  return out;
}

/**
 * Deterministic Unlocker open + literal email extract before the LLM loop.
 * Mutates `session`. Continues after single-page failures (RF-02).
 */
export async function seedBrandPagesForEmailDiscovery(params: {
  client: BrightDataToolsClient;
  session: ContactResearchToolSession;
  preferredUrls?: string[];
  maxSeedPages?: number;
  /** Optional path ladder override (agency contact research). */
  seedPaths?: readonly string[];
}): Promise<SeedBrandPagesResult> {
  const { client, session } = params;
  const preferredUrls = params.preferredUrls ?? [];
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
  let preferredAttempted = 0;

  if (maxSeedPages <= 0) {
    return {
      attemptedUrls,
      openedUrls,
      failedUrls,
      emailsFound: 0,
      preferredAttempted: 0,
    };
  }

  const preferredKeys = new Set(
    preferredUrls
      .map((u) => toCandidateUrl(u))
      .filter((u): u is string => Boolean(u))
      .map((u) => normalizeUrlKey(u)),
  );

  const candidates = buildSeedCandidateUrls(
    session,
    preferredUrls,
    params.seedPaths ?? COMMERCIAL_SEED_PATHS,
  ).slice(0, maxSeedPages);

  for (const url of candidates) {
    if (session.pageCalls >= session.maxPages) break;

    attemptedUrls.push(url);
    if (preferredKeys.has(normalizeUrlKey(url))) {
      preferredAttempted += 1;
    }
    session.pageOriginCounts.seedPagesAttempted += 1;
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
    session.pageOriginCounts.seedPagesDownloaded += 1;
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
    preferredAttempted,
  };
}
