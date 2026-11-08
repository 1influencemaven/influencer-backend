import type { ScoredBrand } from '@influence-maven/ai-contracts';

import { normalizeDomain } from './brand-domain.util';

/**
 * Inputs used to build the evidence allowlist.
 * Mastra-produced URLs must never be passed here.
 */
export type BrandEvidenceAllowlistInput = {
  searchHits?: ReadonlyArray<{ url: string }>;
  seedBrands?: ReadonlyArray<{
    website?: string;
    evidenceUrls?: ReadonlyArray<string>;
  }>;
};

/**
 * Deterministic allowlist derived only from SERP hits and seeds.
 * `urlKeys` match evidence; `domains` authorize website hostnames.
 */
export type BrandEvidenceAllowlist = {
  urlKeys: ReadonlySet<string>;
  domains: ReadonlySet<string>;
};

/** Nest-only classification (AI-004.5.3). Mastra must not emit these values. */
export type BrandEvidenceStatus = 'VERIFIED' | 'UNVERIFIED';

/** Hard discard reasons — not the same as UNVERIFIED. */
export type BrandEvidenceDiscardReason = 'EMPTY_NAME' | 'INVALID_WEBSITE';

export type DiscardedScoredBrand = {
  brand: ScoredBrand;
  reason: BrandEvidenceDiscardReason;
};

/**
 * Result of classifying Mastra scored brands against SERP/seed evidence.
 * UNVERIFIED candidates keep commercial fields; evidenceUrls are cleared.
 */
export type BrandEvidenceFilterResult = {
  verified: ScoredBrand[];
  unverified: ScoredBrand[];
  discarded: DiscardedScoredBrand[];
  allowlist: BrandEvidenceAllowlist;
};

/**
 * Canonical key for evidence URL equality (protocol-agnostic).
 * - lowercases host, strips leading `www.`
 * - keeps pathname (trailing slash stripped except `/`)
 * - keeps search string as-is for exact form
 *
 * Differs from {@link normalizeDomain}: this is path-aware for evidence
 * matching; domain util is hostname-only for dedupe/hard filters.
 */
export function canonicalizeEvidenceUrl(raw: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (!parsed.hostname) {
      return null;
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = parsed.pathname || '/';
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    return `${host}${pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/** Syntactic website check — not existence / ownership verification. */
export function isWebsiteSyntacticallyValid(website: string): boolean {
  const trimmed = website?.trim() ?? '';
  if (!trimmed) {
    return false;
  }
  return (
    canonicalizeEvidenceUrl(trimmed) !== null &&
    Boolean(normalizeDomain(trimmed))
  );
}

/** Host+path without query — secondary key so utm variants still match. */
function evidenceUrlKeyWithoutQuery(canonical: string): string {
  const q = canonical.indexOf('?');
  return q === -1 ? canonical : canonical.slice(0, q);
}

function addUrlToAllowlist(
  raw: string,
  urlKeys: Set<string>,
  domains: Set<string>,
): void {
  const canonical = canonicalizeEvidenceUrl(raw);
  if (!canonical) {
    return;
  }

  urlKeys.add(canonical);
  urlKeys.add(evidenceUrlKeyWithoutQuery(canonical));

  const domain = normalizeDomain(raw);
  if (domain) {
    domains.add(domain);
  }
}

/**
 * Builds allowlist exclusively from searchHits and seedBrands.
 * Does not accept model-proposed URLs.
 */
export function buildBrandEvidenceAllowlist(
  input: BrandEvidenceAllowlistInput,
): BrandEvidenceAllowlist {
  const urlKeys = new Set<string>();
  const domains = new Set<string>();

  for (const hit of input.searchHits ?? []) {
    if (hit?.url) {
      addUrlToAllowlist(hit.url, urlKeys, domains);
    }
  }

  for (const seed of input.seedBrands ?? []) {
    if (seed?.website) {
      addUrlToAllowlist(seed.website, urlKeys, domains);
    }
    for (const url of seed?.evidenceUrls ?? []) {
      addUrlToAllowlist(url, urlKeys, domains);
    }
  }

  return { urlKeys, domains };
}

export function isEvidenceUrlAuthorized(
  raw: string,
  allowlist: BrandEvidenceAllowlist,
): boolean {
  const canonical = canonicalizeEvidenceUrl(raw);
  if (!canonical) {
    return false;
  }
  if (allowlist.urlKeys.has(canonical)) {
    return true;
  }
  return allowlist.urlKeys.has(evidenceUrlKeyWithoutQuery(canonical));
}

function asUnverified(brand: ScoredBrand): ScoredBrand {
  return {
    ...brand,
    evidenceUrls: [],
  };
}

/**
 * Classifies Mastra scored brands against SERP/seed evidence (AI-004.5.3).
 * - VERIFIED: authorized website domain + ≥1 authorized evidenceUrl
 * - UNVERIFIED: valid name+website that is not VERIFIED (evidenceUrls cleared)
 * - discarded: empty/invalid name or website syntax
 *
 * Lack of external evidence alone never discards a syntactically valid brand.
 */
export function filterScoredBrandsByEvidence(
  brands: ReadonlyArray<ScoredBrand>,
  sources: BrandEvidenceAllowlistInput,
): BrandEvidenceFilterResult {
  const allowlist = buildBrandEvidenceAllowlist(sources);
  const verified: ScoredBrand[] = [];
  const unverified: ScoredBrand[] = [];
  const discarded: DiscardedScoredBrand[] = [];

  for (const brand of brands) {
    const name = brand.name?.trim() ?? '';
    if (!name) {
      discarded.push({ brand, reason: 'EMPTY_NAME' });
      continue;
    }

    const website = brand.website?.trim() ?? '';
    if (!website || !isWebsiteSyntacticallyValid(website)) {
      discarded.push({ brand, reason: 'INVALID_WEBSITE' });
      continue;
    }

    const websiteDomain = normalizeDomain(website);
    const domainAuthorized =
      Boolean(websiteDomain) && allowlist.domains.has(websiteDomain);

    const retainedEvidenceUrls = (brand.evidenceUrls ?? []).filter((url) =>
      isEvidenceUrlAuthorized(url, allowlist),
    );

    if (domainAuthorized && retainedEvidenceUrls.length > 0) {
      verified.push({
        ...brand,
        name,
        website,
        evidenceUrls: retainedEvidenceUrls,
      });
      continue;
    }

    unverified.push(
      asUnverified({
        ...brand,
        name,
        website,
      }),
    );
  }

  return { verified, unverified, discarded, allowlist };
}
