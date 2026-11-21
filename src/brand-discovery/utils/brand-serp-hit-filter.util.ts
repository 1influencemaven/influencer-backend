import type { WebSearchHit } from '../interfaces/web-search-provider.interface';
import { normalizeDomain } from './brand-domain.util';

/**
 * Non-brand hosts that Google SERP often returns for partnership queries.
 * Tavily-era scoring expected corporate brand pages; SERP needs this pre-filter.
 */
const BRAND_DISCOVERY_NOISE_HOSTS = new Set([
  'wikipedia.org',
  'en.wikipedia.org',
  'es.wikipedia.org',
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'twitter.com',
  'x.com',
  'pinterest.com',
  'www.pinterest.com',
  'reddit.com',
  'www.reddit.com',
  'quora.com',
  'www.quora.com',
  'linkedin.com',
  'www.linkedin.com',
  'rocketreach.co',
  'apollo.io',
  'zoominfo.com',
  'hunter.io',
  'clearbit.com',
  'similarweb.com',
  'crunchbase.com',
  'www.crunchbase.com',
  /** Org-chart / people directories — secondary mentions, not brand sites. */
  'theorg.com',
  'www.theorg.com',
  'craft.co',
  'www.craft.co',
  'owler.com',
  'www.owler.com',
  /** Document hosts / generic publishers — not corporate brand sites. */
  'scribd.com',
  'www.scribd.com',
  'medium.com',
  'www.medium.com',
  'substack.com',
  'www.substack.com',
  'slideshare.net',
  'www.slideshare.net',
  'issuu.com',
  'www.issuu.com',
  /**
   * VC / accelerator / startup-directory hubs — not advertiser brands.
   * Keep narrow; do not add generic “startup” product sites.
   */
  '500.co',
  'ycombinator.com',
  'www.ycombinator.com',
  'f6s.com',
  'www.f6s.com',
]);

/**
 * Path / URL patterns that indicate secondary content (articles, listicles,
 * how-tos, vendor roundups) rather than a company homepage or catalog.
 * The publisher of such pages must not become the scored brand.
 */
const SECONDARY_CONTENT_PATH_PATTERNS: RegExp[] = [
  /\/blog\//i,
  /\/blogs\//i,
  /\/article\//i,
  /\/articles\//i,
  /\/news\//i,
  /\/press\//i,
  /\/resources?\//i,
  /\/guides?\//i,
  /\/how-to[-/]/i,
  /\/vendors?\//i,
  /\/top-[\w-]*brands?/i,
  /\/top-[\w-]*services?/i,
  /\/top-[\w-]*providers?/i,
  /\/top-[\w-]*companies?/i,
  /\/best-[\w-]*brands?/i,
  /\/best-[\w-]*services?/i,
  /\/best-[\w-]*providers?/i,
  /\/list-of-/i,
  /how-to-create-a-brand-ambassador/i,
  /\/brand-ambassador-program/i,
  /\/affiliate-program\//i,
  /\/pdf(\/|$|\?)/i,
  /\.pdf(\?|$)/i,
];

/**
 * Editorial magazine / trade-press hosts (URL signal only).
 * Matches labels like `managehrmagazine.com` without blocking product retailers
 * that merely mention “magazine” in a path.
 */
function isEditorialMagazineHost(domain: string): boolean {
  return /(^|\.)[a-z0-9-]*magazine(\.|$)/i.test(domain);
}

export type SerpHitDiscardReason =
  | 'noise_host'
  | 'secondary_content'
  | 'duplicate_domain'
  | 'invalid_url';

export type SerpHitFilterDiscard = {
  title: string;
  url: string;
  domain: string;
  reason: SerpHitDiscardReason;
};

export type SerpHitFilterDiagnostics = {
  receivedCount: number;
  keptCount: number;
  discardedCount: number;
  duplicateDomainCount: number;
  noiseHostCount: number;
  secondaryContentCount: number;
  invalidUrlCount: number;
  /** True when filter would empty the list and original hits were restored. */
  fallbackToRaw: boolean;
  discarded: SerpHitFilterDiscard[];
  keptDomains: string[];
};

export type SerpHitFilterResult = {
  hits: WebSearchHit[];
  diagnostics: SerpHitFilterDiagnostics;
};

function isNoiseHost(domain: string): boolean {
  if (!domain) {
    return true;
  }
  if (isEditorialMagazineHost(domain)) {
    return true;
  }
  if (BRAND_DISCOVERY_NOISE_HOSTS.has(domain)) {
    return true;
  }
  // Match subdomains of blocked registrable hosts (e.g. es.linkedin.com).
  for (const blocked of BRAND_DISCOVERY_NOISE_HOSTS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) {
      return true;
    }
  }
  return false;
}

export function isSecondaryContentUrl(url: string): boolean {
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const haystack = `${pathname} ${url}`;
  return SECONDARY_CONTENT_PATH_PATTERNS.some((re) => re.test(haystack));
}

function emptyDiagnostics(receivedCount: number): SerpHitFilterDiagnostics {
  return {
    receivedCount,
    keptCount: 0,
    discardedCount: 0,
    duplicateDomainCount: 0,
    noiseHostCount: 0,
    secondaryContentCount: 0,
    invalidUrlCount: 0,
    fallbackToRaw: false,
    discarded: [],
    keptDomains: [],
  };
}

/**
 * Soft-filter SERP hits before SCORE with discard observability.
 * Drops social / wiki / people-directory noise and secondary content paths
 * when at least one useful hit remains. Dedupes by domain (first hit wins).
 * If filtering would empty the list, returns the original hits unchanged so
 * SCORE still sees evidence.
 */
export function filterBrandDiscoverySearchHitsWithDiagnostics(
  hits: ReadonlyArray<WebSearchHit>,
): SerpHitFilterResult {
  if (hits.length === 0) {
    return { hits: [], diagnostics: emptyDiagnostics(0) };
  }

  const useful: WebSearchHit[] = [];
  const discarded: SerpHitFilterDiscard[] = [];
  const seenDomains = new Set<string>();
  let duplicateDomainCount = 0;
  let noiseHostCount = 0;
  let secondaryContentCount = 0;
  let invalidUrlCount = 0;

  for (const hit of hits) {
    const domain = normalizeDomain(hit.url);
    if (!domain) {
      invalidUrlCount += 1;
      discarded.push({
        title: hit.title,
        url: hit.url,
        domain: '',
        reason: 'invalid_url',
      });
      continue;
    }
    if (isNoiseHost(domain)) {
      noiseHostCount += 1;
      discarded.push({
        title: hit.title,
        url: hit.url,
        domain,
        reason: 'noise_host',
      });
      continue;
    }
    if (isSecondaryContentUrl(hit.url)) {
      secondaryContentCount += 1;
      discarded.push({
        title: hit.title,
        url: hit.url,
        domain,
        reason: 'secondary_content',
      });
      continue;
    }
    if (seenDomains.has(domain)) {
      duplicateDomainCount += 1;
      discarded.push({
        title: hit.title,
        url: hit.url,
        domain,
        reason: 'duplicate_domain',
      });
      continue;
    }
    seenDomains.add(domain);
    useful.push(hit);
  }

  if (useful.length === 0) {
    return {
      hits: [...hits],
      diagnostics: {
        receivedCount: hits.length,
        keptCount: hits.length,
        discardedCount: discarded.length,
        duplicateDomainCount,
        noiseHostCount,
        secondaryContentCount,
        invalidUrlCount,
        fallbackToRaw: true,
        discarded,
        keptDomains: hits
          .map((h) => normalizeDomain(h.url))
          .filter((d): d is string => Boolean(d)),
      },
    };
  }

  return {
    hits: useful,
    diagnostics: {
      receivedCount: hits.length,
      keptCount: useful.length,
      discardedCount: discarded.length,
      duplicateDomainCount,
      noiseHostCount,
      secondaryContentCount,
      invalidUrlCount,
      fallbackToRaw: false,
      discarded,
      keptDomains: [...seenDomains],
    },
  };
}

/**
 * Soft-filter SERP hits before SCORE (Tavily-style evidence quality).
 * Convenience wrapper — prefer {@link filterBrandDiscoverySearchHitsWithDiagnostics}
 * when callers need discard reasons.
 */
export function filterBrandDiscoverySearchHits(
  hits: ReadonlyArray<WebSearchHit>,
): WebSearchHit[] {
  return filterBrandDiscoverySearchHitsWithDiagnostics(hits).hits;
}
