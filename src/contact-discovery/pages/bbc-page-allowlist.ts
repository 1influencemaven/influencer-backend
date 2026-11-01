import { domainFromUrl } from '../../integrations/brightdata';

/**
 * BBC v1 page allowlist (GAP-042 / ADR-0020).
 *
 * Design rules:
 * - Prefer one canonical path per intent (no /affiliate + /affiliates pairs).
 * - Primary paths fit under default MAX_BRAND_BUSINESS_CONTACT_PAGES (12)
 *   so secondary paths are reachable when the env allows.
 * - Homepage `/` is last (noisy HTML); optional under maxPages.
 *
 * Intent → path:
 * partnerships, collaborations, influencers, creators, affiliates, press, contact.
 */

export const BBC_V1_PRIMARY_PATHS = [
  '/partnerships',
  '/collaborations',
  '/influencers',
  '/creators',
  '/affiliates',
  '/press',
  '/contact',
] as const;

/** Fetched only after primary when maxPages still has budget. */
export const BBC_V1_SECONDARY_PATHS = [
  '/contact-us',
  '/about',
  '/',
] as const;

export const BBC_V1_FETCH_PATHS = [
  ...BBC_V1_PRIMARY_PATHS,
  ...BBC_V1_SECONDARY_PATHS,
] as const;

/** Default product cap aligned with env default (12). */
export const BBC_V1_DEFAULT_MAX_PAGES = 12;

export function normalizeWebsiteBase(website: string): string | null {
  const trimmed = website.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!url.hostname) {
      return null;
    }
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function normalizeBbcPageUrl(
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

/**
 * Build ordered page URLs for BBC v1 Unlocker fetches.
 * Respects `maxPages`; never invents hosts outside the brand website.
 */
export function buildBbcV1PageUrls(
  website: string,
  maxPages: number = BBC_V1_DEFAULT_MAX_PAGES,
): string[] {
  const base = normalizeWebsiteBase(website);
  if (!base || maxPages < 1) {
    return [];
  }

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const path of BBC_V1_FETCH_PATHS) {
    if (urls.length >= maxPages) {
      break;
    }
    const raw = path === '/' ? base : `${base}${path}`;
    const normalized = normalizeBbcPageUrl(raw, base);
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

export function isSameBrandHost(pageUrl: string, brandWebsite: string): boolean {
  const base = normalizeWebsiteBase(brandWebsite);
  if (!base) {
    return false;
  }
  return normalizeBbcPageUrl(pageUrl, base) !== null;
}

/** Hostname helper for diagnostics (no secrets). */
export function brandHostFromWebsite(website: string): string {
  const base = normalizeWebsiteBase(website);
  if (!base) {
    return '';
  }
  return domainFromUrl(base);
}
