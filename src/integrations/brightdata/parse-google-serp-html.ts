import type { SearchResultItem } from './search.types';
import { domainFromUrl } from './url-domain.util';

const BLOCKED_HOST_PATTERNS = [
  /(^|\.)google\./i,
  /(^|\.)googleapis\.com$/i,
  /(^|\.)gstatic\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)schema\.org$/i,
  /(^|\.)w3\.org$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
];

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    );
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * Resolves a Google SERP href into an absolute external URL, or null if unusable.
 */
export function unwrapGoogleHref(hrefRaw: string): string | null {
  const href = decodeBasicEntities(hrefRaw.trim());
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
    return null;
  }

  let candidate = href;
  if (href.startsWith('/url?')) {
    try {
      const params = new URLSearchParams(href.slice('/url?'.length));
      candidate = params.get('q') ?? params.get('url') ?? '';
    } catch {
      return null;
    }
  }

  if (candidate.startsWith('/')) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (isBlockedHost(parsed.hostname)) {
      return null;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

/** True when the body looks like HTML rather than plain text / JSON / error blob. */
export function looksLikeHtmlDocument(body: string): boolean {
  return /<\s*(?:html|body|div|a|h3|span|title)\b/i.test(body);
}

type RawHit = { url: string; title: string; snippet: string };

/**
 * Extracts organic-like results from a Google SERP HTML document.
 * Prefer anchors that wrap an <h3> (classic organic card); fall back to other external links.
 */
export function parseGoogleSerpHtml(
  html: string,
  options?: { maxResults?: number },
): SearchResultItem[] {
  const maxResults =
    typeof options?.maxResults === 'number' && options.maxResults > 0
      ? Math.floor(options.maxResults)
      : undefined;

  if (!html || !html.trim()) {
    return [];
  }

  const hits: RawHit[] = [];
  const seen = new Set<string>();

  const pushHit = (url: string, title: string, snippet = '') => {
    if (seen.has(url)) return;
    seen.add(url);
    const cleanTitle = decodeBasicEntities(stripTags(title));
    hits.push({
      url,
      title: cleanTitle || url,
      snippet: decodeBasicEntities(stripTags(snippet)).slice(0, 500),
    });
  };

  // Pattern A: <a href="..."><h3>...</h3>
  const anchorWithH3 =
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorWithH3.exec(html)) !== null) {
    const url = unwrapGoogleHref(match[1] ?? '');
    if (!url) continue;
    pushHit(url, match[2] ?? '');
    if (maxResults !== undefined && hits.length >= maxResults) {
      return hits.slice(0, maxResults).map((h, i) => toItem(h, i));
    }
  }

  // Pattern B: <h3>...</h3> ... nearby <a href="..."> (limited lookaround window)
  if (hits.length === 0) {
    const h3Blocks = /<h3\b[^>]*>([\s\S]*?)<\/h3>([\s\S]{0,400})/gi;
    while ((match = h3Blocks.exec(html)) !== null) {
      const title = match[1] ?? '';
      const window = match[2] ?? '';
      const hrefMatch = window.match(
        /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i,
      );
      if (!hrefMatch) continue;
      const url = unwrapGoogleHref(hrefMatch[1] ?? '');
      if (!url) continue;
      pushHit(url, title);
      if (maxResults !== undefined && hits.length >= maxResults) {
        return hits.slice(0, maxResults).map((h, i) => toItem(h, i));
      }
    }
  }

  // Pattern C: /url?q= external targets without h3 (last resort)
  if (hits.length === 0) {
    const urlQ = /href\s*=\s*["'](\/url\?[^"']+)["']/gi;
    while ((match = urlQ.exec(html)) !== null) {
      const url = unwrapGoogleHref(match[1] ?? '');
      if (!url) continue;
      pushHit(url, url);
      if (maxResults !== undefined && hits.length >= maxResults) {
        break;
      }
    }
  }

  const sliced =
    maxResults !== undefined ? hits.slice(0, maxResults) : hits;
  return sliced.map((h, i) => toItem(h, i));
}

function toItem(hit: RawHit, index: number): SearchResultItem {
  return {
    title: hit.title,
    url: hit.url,
    snippet: hit.snippet,
    position: index + 1,
    domain: domainFromUrl(hit.url),
  };
}
