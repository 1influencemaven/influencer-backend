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
 * Best-effort organic extraction from Google SERP HTML.
 * Enough for the agent tool; Nest has a fuller parser for Brand Discovery.
 */
export function parseOrganicHits(html: string, limit = 8): BrightDataOrganicHit[] {
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
