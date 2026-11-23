/**
 * Same-site links on an opened page that look like commercial-contact pages.
 * Brand sites rarely use the guessed paths (`/partnerships`); Shopify stores
 * use `/pages/<slug>` ("/pages/collaborate", "/pages/gorjana-ambassadors"), so
 * reading the real nav/footer links finds them.
 */

const LINK_RE = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

const TIERS: ReadonlyArray<{ score: number; re: RegExp }> = [
  {
    score: 3,
    re: /partner|collab|influenc|creator|ambassador|affiliate|brand-?rep|\bugc\b/i,
  },
  { score: 2, re: /\bpress\b|\bmedia\b|newsroom|\bpr\b|wholesale/i },
  { score: 1, re: /contact|get-?in-?touch|\babout\b/i },
];

const EXCLUDED_PATH =
  /\/(products?|collections?|cart|checkout|account|login|signin|register|search|blogs?\/[^/]+\/.+|policies)\b|\.(jpe?g|png|gif|svg|webp|pdf|css|js)$/i;

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractCommercialLinks(
  html: string,
  pageUrl: string,
  limit = 6,
): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const baseHost = base.hostname.replace(/^www\./, '');
  const scored = new Map<string, number>();

  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(html)) !== null) {
    const href = (match[1] ?? '').trim();
    if (
      !href ||
      href.startsWith('#') ||
      /^(mailto|tel|javascript):/i.test(href)
    )
      continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (url.hostname.replace(/^www\./, '') !== baseHost) continue;
    url.hash = '';
    url.search = '';
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || EXCLUDED_PATH.test(path)) continue;

    const blob = `${path} ${stripTags(match[2] ?? '')}`;
    const score = TIERS.find((tier) => tier.re.test(blob))?.score ?? 0;
    if (score === 0) continue;

    const key = `${url.origin}${path}`;
    scored.set(key, Math.max(scored.get(key) ?? 0, score));
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([url]) => url);
}
