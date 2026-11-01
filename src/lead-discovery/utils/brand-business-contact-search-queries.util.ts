import { sanitizeQueryFragment } from './query-sanitize.util';

/**
 * SERP queries aimed at surface brand commercial / generic inbox emails
 * (partnerships, influencer, affiliate, collaborations, press).
 * Does not invent emails — only guides Search toward pages/snippets that may contain them.
 */
export function buildBrandBusinessContactSearchQueries(input: {
  brandName: string;
  domain: string;
  maxQueries?: number;
}): string[] {
  const brand = sanitizeQueryFragment(input.brandName);
  const domain = sanitizeQueryFragment(input.domain.replace(/^www\./i, ''));
  if (!brand && !domain) {
    return [];
  }

  const label = brand || domain;
  const site = domain ? `site:${domain}` : '';
  const max = Math.max(1, Math.min(input.maxQueries ?? 8, 12));
  const queries: string[] = [];
  const seen = new Set<string>();

  const push = (q: string) => {
    const key = q.toLowerCase();
    if (!key || seen.has(key) || queries.length >= max) {
      return;
    }
    seen.add(key);
    queries.push(q);
  };

  if (site) {
    push(
      `${site} (partnerships OR "influencer marketing" OR affiliate OR collaborations OR press) (email OR contact OR "@")`,
    );
    push(`${site} partnerships email`);
    push(`${site} "influencer marketing" email`);
    push(`${site} affiliate OR ambassadors email`);
    push(`${site} press OR media contact email`);
  }

  push(`"${label}" partnerships email OR contact`);
  push(`"${label}" "influencer marketing" email`);
  push(`"${label}" collaborations OR creators email`);

  return queries;
}
