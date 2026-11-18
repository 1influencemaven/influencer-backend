import { normalizeDomain } from './brand-domain.util';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

/** IPv4 private / link-local / loopback ranges (SSRF). */
function isBlockedIpv4(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) {
    return false;
  }
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isBlockedIpv6(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === '::1' ||
    h === '::' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe80')
  );
}

export type BrandResearchUrlGuardResult =
  | { ok: true; url: string; hostname: string; domain: string }
  | { ok: false; reason: string };

/**
 * True when hostname is the brand domain or a subdomain of it
 * (e.g. shop.brand.com under brand.com). Rejects brand.com.evil.com.
 */
export function isAuthorizedBrandHost(
  hostname: string,
  brandDomain: string,
): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const brand = brandDomain.toLowerCase().replace(/^www\./, '');
  if (!host || !brand) {
    return false;
  }
  return host === brand || host.endsWith(`.${brand}`);
}

/**
 * Validate a candidate Unlocker URL before fetch (and after redirect signals).
 */
export function assertBrandResearchUrl(
  rawUrl: string,
  brandDomain: string,
): BrandResearchUrlGuardResult {
  const trimmed = rawUrl?.trim() ?? '';
  if (!trimmed) {
    return { ok: false, reason: 'empty_url' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'invalid_protocol' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { ok: false, reason: 'missing_hostname' };
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'blocked_hostname' };
  }

  if (isBlockedIpv4(hostname) || isBlockedIpv6(hostname)) {
    return { ok: false, reason: 'blocked_ip' };
  }

  const brand = normalizeDomain(brandDomain);
  if (!isAuthorizedBrandHost(hostname, brand)) {
    return { ok: false, reason: 'off_domain' };
  }

  // Drop credentials in URL
  parsed.username = '';
  parsed.password = '';

  return {
    ok: true,
    url: parsed.toString(),
    hostname,
    domain: normalizeDomain(hostname),
  };
}

/**
 * Extract a final/canonical URL hint from HTML when Unlocker does not expose redirects.
 * Only returns absolute http(s) URLs.
 */
export function extractCanonicalOrFinalUrlHint(html: string): string | null {
  if (!html?.trim()) {
    return null;
  }
  const canonical =
    html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i,
    );
  if (canonical?.[1]) {
    const href = canonical[1].trim();
    if (/^https?:\/\//i.test(href)) {
      return href;
    }
  }
  const og =
    html.match(
      /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i,
    );
  if (og?.[1] && /^https?:\/\//i.test(og[1].trim())) {
    return og[1].trim();
  }
  return null;
}
