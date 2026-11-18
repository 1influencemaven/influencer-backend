/**
 * RF-02.1: sanitize Brand Discovery evidenceUrls before FIND_BRAND_EMAILS publish.
 * Invalid / non-http(s) values are dropped — never fail the whole job.
 * On-domain enforcement remains in Mastra seed (isAllowedUrl).
 */

const DEFAULT_MAX = 12;

export function sanitizeContactResearchSeedUrls(
  urls: unknown,
  max = DEFAULT_MAX,
): string[] {
  if (!Array.isArray(urls) || max <= 0) {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      continue;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      continue;
    }

    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const normalized =
      path === '/'
        ? `${parsed.origin}/`
        : `${parsed.origin}${path}${parsed.search}`;

    const key = normalized.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }

  return out;
}
