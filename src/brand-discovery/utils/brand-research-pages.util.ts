import type { BrandResearchPageRole } from '@influence-maven/ai-contracts';

import { ensureWebsiteUrl, normalizeDomain } from './brand-domain.util';
import { assertBrandResearchUrl } from './brand-research-url-guard.util';

export const BRAND_RESEARCH_MAX_PAGES = 4;

const PATH_CANDIDATES: Array<{ path: string; role: BrandResearchPageRole }> = [
  { path: '/about', role: 'about' },
  { path: '/about-us', role: 'about' },
  { path: '/company', role: 'about' },
  { path: '/products', role: 'products' },
  { path: '/collections', role: 'products' },
  { path: '/shop', role: 'products' },
  { path: '/partners', role: 'partnerships' },
  { path: '/partnerships', role: 'partnerships' },
  { path: '/affiliate', role: 'partnerships' },
  { path: '/affiliates', role: 'partnerships' },
  { path: '/creators', role: 'partnerships' },
  { path: '/influencer', role: 'partnerships' },
  { path: '/ambassadors', role: 'partnerships' },
];

export type BrandResearchPageCandidate = {
  url: string;
  role: BrandResearchPageRole;
};

/**
 * Build up to 4 unique authorized URLs: homepage + heuristic paths.
 * Does not fetch — Nest validates again before Unlocker.
 */
export function buildBrandResearchPageCandidates(params: {
  website: string;
  domain: string;
  extraUrls?: string[];
  maxPages?: number;
}): BrandResearchPageCandidate[] {
  const maxPages = Math.min(
    params.maxPages ?? BRAND_RESEARCH_MAX_PAGES,
    BRAND_RESEARCH_MAX_PAGES,
  );
  const brandDomain = normalizeDomain(params.domain || params.website);
  const homepage = ensureWebsiteUrl(params.website);
  const seen = new Set<string>();
  const out: BrandResearchPageCandidate[] = [];

  const push = (raw: string, role: BrandResearchPageRole) => {
    if (out.length >= maxPages) {
      return;
    }
    const guarded = assertBrandResearchUrl(raw, brandDomain);
    if (!guarded.ok) {
      return;
    }
    const key = guarded.url.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({ url: guarded.url, role });
  };

  push(homepage, 'homepage');

  try {
    const origin = new URL(
      /^https?:\/\//i.test(homepage) ? homepage : `https://${homepage}`,
    ).origin;
    for (const candidate of PATH_CANDIDATES) {
      push(`${origin}${candidate.path}`, candidate.role);
      if (out.length >= maxPages) {
        break;
      }
    }
  } catch {
    // homepage unparseable — rely on extras
  }

  for (const extra of params.extraUrls ?? []) {
    push(extra, 'other');
  }

  return out;
}

/** Deduplicate URL list preserving order (normalized without trailing slash). */
export function dedupeResearchUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
