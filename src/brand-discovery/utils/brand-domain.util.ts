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

export function ensureWebsiteUrl(website: string): string {
  if (/^https?:\/\//i.test(website)) {
    return website;
  }
  return `https://${website}`;
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
