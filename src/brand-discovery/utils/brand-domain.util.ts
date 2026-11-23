/**
 * Hosts where the brand identity lives in the path (not the registrable domain).
 * Keep pathname; still strip query/hash tracking.
 */
const PATH_SCOPED_WEBSITE_HOSTS = new Set([
  'linktr.ee',
  'linkin.bio',
  'bio.site',
  'beacons.ai',
  'carrd.co',
]);

/** True for link-in-bio hosts whose brand identity lives in the path (not a brand domain). */
export function isPathScopedHost(host: string): boolean {
  return PATH_SCOPED_WEBSITE_HOSTS.has(host.toLowerCase().replace(/^www\./, ''));
}

export function normalizeDomain(website: string): string {
  try {
    const withProtocol = /^https?:\/\//i.test(website)
      ? website
      : `https://${website}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch {
    return website
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .trim();
  }
}

/**
 * Corporate website hygiene (Tavily-era rule: prefer a real brand homepage).
 * - adds https when missing
 * - strips www, query, and hash (SERP tracking e.g. srsltid)
 * - reduces to origin for normal domains (no deep landing paths as website)
 * - keeps pathname only for known path-scoped hosts (linktr.ee, …)
 *
 * evidenceUrls may still keep the original SERP deep link.
 */
export function ensureWebsiteUrl(website: string): string {
  const trimmed = website?.trim() ?? '';
  if (!trimmed) {
    return trimmed;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (!parsed.hostname) {
      return withProtocol;
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (PATH_SCOPED_WEBSITE_HOSTS.has(host)) {
      let pathname = parsed.pathname || '/';
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      return pathname === '/'
        ? `https://${host}`
        : `https://${host}${pathname}`;
    }

    return `https://${host}`;
  } catch {
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `https://${trimmed}`;
  }
}

export function dedupeByDomain(
  candidates: Array<{ domain: string }>,
): typeof candidates {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.domain || seen.has(candidate.domain)) {
      return false;
    }
    seen.add(candidate.domain);
    return true;
  });
}

/**
 * Drops candidates whose domain (or website hostname) already exists
 * for the influencer across prior Brand Discovery runs.
 */
export function excludeExistingDomains<
  T extends { domain?: string; website?: string },
>(candidates: T[], existingDomains: ReadonlySet<string>): T[] {
  return candidates.filter((candidate) => {
    const raw = candidate.domain || candidate.website || '';
    if (!raw) {
      return false;
    }
    const domain = normalizeDomain(raw);
    if (!domain || existingDomains.has(domain)) {
      return false;
    }
    return true;
  });
}
