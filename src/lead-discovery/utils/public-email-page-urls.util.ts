const DEFAULT_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/pages/contact',
  '/about',
  '/team',
] as const;

export function buildPublicEmailPageUrls(
  website: string,
  maxPages: number,
): string[] {
  const base = normalizeWebsiteBase(website);
  if (!base) {
    return [];
  }

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const path of DEFAULT_PATHS) {
    if (urls.length >= maxPages) {
      break;
    }
    const url = path === '/' ? base : `${base}${path}`;
    const key = url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    urls.push(url);
  }

  return urls;
}

export function normalizeWebsiteBase(website: string): string | null {
  const trimmed = website.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (!url.hostname || url.hostname.includes('linkedin.com')) {
    return null;
  }

  return `${url.protocol}//${url.host}`;
}
