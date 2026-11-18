/**
 * Track 2C.1 — normalize agency host for Agency.domain uniqueness.
 * Mirrors Brand Discovery host hygiene (lowercase, strip www) without
 * path-scoped special cases (agencies are corporate domains).
 */
export function normalizeAgencyDomain(websiteOrHost: string): string {
  const trimmed = websiteOrHost?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      ?.split('?')[0]
      ?.trim() ?? '';
  }
}

/**
 * Soft name key for Agency.normalizedName (search aid; not unique).
 * Collapse whitespace and lowercase; keep alphanumerics and spaces.
 */
export function normalizeAgencyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
