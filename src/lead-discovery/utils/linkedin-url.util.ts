const BLOCKED_LINKEDIN_PATHS =
  /\/(company|posts|jobs|school|feed|pulse|groups)\//i;

export function normalizePeopleLinkedInUrl(url?: string): string | null {
  if (!url?.trim()) {
    return null;
  }
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.endsWith('linkedin.com')) {
      return null;
    }
    if (BLOCKED_LINKEDIN_PATHS.test(parsed.pathname)) {
      return null;
    }
    const match = parsed.pathname.match(/\/in\/([^/]+)/i);
    if (!match?.[1]) {
      return null;
    }
    const slug = decodeURIComponent(match[1]).trim();
    if (!slug) {
      return null;
    }
    return `https://www.linkedin.com/in/${slug}`;
  } catch {
    return null;
  }
}

export function extractLinkedInSlug(url: string): string | null {
  const normalized = normalizePeopleLinkedInUrl(url);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/\/in\/([^/]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
