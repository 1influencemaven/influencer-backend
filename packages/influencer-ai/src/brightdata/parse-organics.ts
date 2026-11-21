import type { BrightDataOrganicHit } from './types';

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value: string): string {
  return decodeBasicEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host.includes('google.') ||
    host.includes('gstatic.') ||
    host.includes('youtube.') ||
    host.includes('schema.org')
  );
}

/**
 * Google wraps some organic results as `https://www.google.com/goto?url=<opaque>`.
 * The real page is not decodable, but `display_link` carries it as
 * `https://host › path › segments...` (the path may be truncated with "..." / "…").
 * Rebuild a usable URL from it; null when `link` is not a wrapper or cannot be rebuilt.
 */
export function unwrapGoogleGotoLink(
  link: string,
  displayLink: unknown,
): string | null {
  let host: string;
  let path: string;
  try {
    const parsed = new URL(link);
    host = parsed.hostname;
    path = parsed.pathname;
  } catch {
    return null;
  }
  if (!/(^|\.)google\./i.test(host) || !/^\/(goto|url)\b/.test(path)) {
    return null;
  }
  if (typeof displayLink !== 'string') return null;

  const [origin, ...segments] = displayLink
    .split('›')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!origin || !/^https?:\/\//i.test(origin)) return null;
  try {
    const base = new URL(origin);
    if (isBlockedHost(base.hostname)) return null;
    const truncated = segments.some((s) => /(\.{3}|…)$/.test(s));
    const cleanSegments = segments
      .map((s) => s.replace(/(\.{3}|…)$/, ''))
      .filter(Boolean);
    return truncated || cleanSegments.length === 0
      ? `${base.origin}/`
      : `${base.origin}/${cleanSegments.join('/')}`;
  } catch {
    return null;
  }
}

/**
 * Prefer Bright Data `brd_json=1` JSON organics; fall back to HTML href scrape.
 */
export function parseOrganicHits(
  body: string,
  limit = 8,
): BrightDataOrganicHit[] {
  const fromJson = parseBrdJsonOrganics(body, limit);
  if (fromJson !== null) {
    return fromJson;
  }
  return parseOrganicHitsFromHtml(body, limit);
}

function parseBrdJsonOrganics(
  body: string,
  limit: number,
): BrightDataOrganicHit[] | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  const organic = Array.isArray(root.organic) ? root.organic : null;
  if (!organic) return null;

  const hits: BrightDataOrganicHit[] = [];
  const seen = new Set<string>();
  for (const row of organic) {
    if (hits.length >= limit) break;
    if (!row || typeof row !== 'object') continue;
    const item = row as {
      link?: unknown;
      url?: unknown;
      title?: unknown;
      description?: unknown;
      display_link?: unknown;
    };
    const rawUrl =
      typeof item.link === 'string'
        ? item.link.trim()
        : typeof item.url === 'string'
          ? item.url.trim()
          : '';
    const url = unwrapGoogleGotoLink(rawUrl, item.display_link) ?? rawUrl;
    if (!url.startsWith('http')) continue;
    try {
      const host = new URL(url).hostname;
      if (isBlockedHost(host)) continue;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const title =
      typeof item.title === 'string' && item.title.trim()
        ? item.title.trim()
        : url;
    const snippet =
      typeof item.description === 'string' ? item.description.slice(0, 220) : '';
    hits.push({ title, url, snippet });
  }
  return hits;
}

/** Best-effort organic extraction from Google SERP HTML (legacy fallback). */
export function parseOrganicHitsFromHtml(
  html: string,
  limit = 8,
): BrightDataOrganicHit[] {
  const hits: BrightDataOrganicHit[] = [];
  const seen = new Set<string>();

  const hrefRe = /href="(https?:\/\/[^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) !== null && hits.length < limit) {
    let url = match[1];
    try {
      // Unwrap Google redirect URLs when present
      if (url.includes('/url?') && url.includes('q=')) {
        const u = new URL(url);
        const q = u.searchParams.get('q') ?? u.searchParams.get('url');
        if (q?.startsWith('http')) url = q;
      }
      const host = new URL(url).hostname;
      if (isBlockedHost(host)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      const window = html.slice(Math.max(0, match.index - 200), match.index + 400);
      const titleMatch = window.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      const title = titleMatch ? stripTags(titleMatch[1]) : host;
      hits.push({
        title: title || host,
        url,
        snippet: stripTags(window).slice(0, 220),
      });
    } catch {
      continue;
    }
  }

  return hits;
}
