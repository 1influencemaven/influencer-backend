/** Commercial / contact paths for Track 2B Fase B (PEE on brand domain). */
export const BRAND_PEE_PATHS = [
  '/contact',
  '/contact-us',
  '/pages/contact',
  '/pages/contact-us',
  '/about',
  '/about-us',
  '/pages/about',
  '/team',
  '/pages/team',
  '/press',
  '/media',
  '/partnerships',
  '/collaborations',
  '/affiliate',
  '/influencers',
  '/creators',
] as const;

export function buildBrandPeeCandidateUrls(
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

  const candidates = [origin + '/', ...BRAND_PEE_PATHS.map((p) => `${origin}${p}`)];
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
