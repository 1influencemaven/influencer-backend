/**
 * Keep only public LinkedIn people profile URLs (/in/...).
 * Reject company, jobs, search, etc.
 */
export function normalizeLinkedInPeopleUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.endsWith('linkedin.com')) return null;

    const path = url.pathname.replace(/\/+$/, '');
    const match = path.match(/^\/in\/([^/]+)/i);
    if (!match?.[1]) return null;

    const slug = decodeURIComponent(match[1]).trim();
    if (!slug || slug.length < 1) return null;

    // Keep slug path-safe; spaces → hyphen (LinkedIn style). Slugs are
    // case-insensitive: lower-case so "Daniella-magee" and "daniella-magee"
    // (seen via different country subdomains) dedupe to one lead.
    const safe = slug.replace(/\s+/g, '-').toLowerCase();
    return `https://www.linkedin.com/in/${safe}`;
  } catch {
    return null;
  }
}

export function collectLinkedInPeopleUrls(
  urls: string[],
  limit: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const normalized = normalizeLinkedInPeopleUrl(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}
