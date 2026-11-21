import { AGENCY_COMMERCIAL_SEED_PATHS } from './agency-seed-paths';

/**
 * Agency-site PEE candidates for FIND_AGENCY_PEOPLE (after LinkedIn).
 * Prefers team/about/contact/partnerships paths from the agency seed ladder.
 */
export function buildAgencyPeeCandidateUrls(
  website: string,
  maxPages: number,
): string[] {
  let origin: string;
  try {
    const withProtocol = /^https?:\/\//i.test(website.trim())
      ? website.trim()
      : `https://${website.trim()}`;
    const url = new URL(withProtocol);
    origin = url.origin;
  } catch {
    return [];
  }

  const preferred = [
    '/team',
    '/about',
    '/about-us',
    '/contact',
    '/contact-us',
    '/company',
    ...AGENCY_COMMERCIAL_SEED_PATHS,
  ];
  const candidates = [origin + '/', ...preferred.map((p) => `${origin}${p}`)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const key = c.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= maxPages) break;
  }
  return out;
}
