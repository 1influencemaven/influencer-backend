import { normalizeWebsiteBase } from './public-email-page-urls.util';

/**
 * Phase 2A v1 — commercial-intent paths only (ordered).
 * Secondary paths (/contact-us, /about, /team, /, /press, …) reserved for future expansion.
 */
export const BRAND_BUSINESS_CONTACT_PATHS = [
  '/partnerships',
  '/affiliate',
  '/affiliates',
  '/creators',
  '/creator',
  '/influencer',
  '/influencers',
  '/ambassador',
  '/ambassadors',
  '/collaboration',
  '/collaborations',
  '/contact',
] as const;

/** Documented for future expansion — not fetched in Phase 2A v1. */
export const BRAND_BUSINESS_CONTACT_SECONDARY_PATHS = [
  '/contact-us',
  '/pages/contact',
  '/pages/contact-us',
  '/press',
  '/about',
  '/team',
  '/',
] as const;

/**
 * Normalize a candidate page URL for fetch + dedupe:
 * same host as base, strip query/hash, strip trailing slash (except bare host).
 */
export function normalizeBrandBusinessContactPageUrl(
  rawUrl: string,
  websiteBase: string,
): string | null {
  try {
    const url = new URL(rawUrl.trim());
    const base = new URL(websiteBase);
    if (url.hostname.toLowerCase() !== base.hostname.toLowerCase()) {
      return null;
    }
    url.hash = '';
    url.search = '';
    const pathname = url.pathname.replace(/\/+$/, '') || '';
    return pathname
      ? `${url.protocol}//${url.host}${pathname}`
      : `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function buildBrandBusinessContactPageUrls(
  website: string,
  maxPages: number,
): string[] {
  const base = normalizeWebsiteBase(website);
  if (!base) {
    return [];
  }

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const path of BRAND_BUSINESS_CONTACT_PATHS) {
    if (urls.length >= maxPages) {
      break;
    }
    const raw = `${base}${path}`;
    const normalized = normalizeBrandBusinessContactPageUrl(raw, base);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    urls.push(normalized);
  }

  return urls;
}
