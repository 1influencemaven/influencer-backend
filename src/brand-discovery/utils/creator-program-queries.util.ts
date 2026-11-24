import type { WebSearchHit } from '../interfaces/web-search-provider.interface';
import { normalizeDomain } from './brand-domain.util';

/**
 * plan_v3 Paso 2A: brands with an active creator / ambassador / influencer
 * program have budget for collaborations. One SERP call per niche term finds
 * their program pages on the brand's own site.
 */
export function buildCreatorProgramQueries(
  terms: ReadonlyArray<string | null | undefined>,
  max: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (max <= 0) return out;
  for (const raw of terms) {
    const term = (raw ?? '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
    const key = term.toLowerCase();
    if (term.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(
      `"${term}" brand ("creator program" OR "influencer program" OR "ambassador program" OR inurl:creators OR inurl:ambassador OR inurl:collab)`,
    );
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Program hits go first (budget signal), deduped by domain against the
 * regular SERP hits. Every program domain is reported, including ones the
 * regular pass had already found.
 */
export function mergeCreatorProgramHits(
  searchHits: WebSearchHit[],
  programHits: WebSearchHit[],
): { hits: WebSearchHit[]; programDomains: string[] } {
  const programDomains = new Set<string>();
  const front: WebSearchHit[] = [];
  for (const hit of programHits) {
    const domain = normalizeDomain(hit.url);
    if (!domain || programDomains.has(domain)) continue;
    programDomains.add(domain);
    front.push(hit);
  }
  const rest = searchHits.filter((hit) => {
    const domain = normalizeDomain(hit.url);
    return !domain || !programDomains.has(domain);
  });
  return { hits: [...front, ...rest], programDomains: [...programDomains] };
}
