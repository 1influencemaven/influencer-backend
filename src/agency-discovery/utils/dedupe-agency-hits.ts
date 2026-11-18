import { normalizeAgencyDomain } from '../../lead-discovery/utils/agency-domain.util';

export type AgencySerpHitLike = {
  title: string;
  url: string;
  content?: string;
};

/**
 * Dedupe SERP hits by normalized domain. Keeps first occurrence (query order).
 * Drops hits with unparseable / empty domains.
 */
export function dedupeAgencySerpHits<T extends AgencySerpHitLike>(
  hits: T[],
): { unique: T[]; duplicateCount: number; droppedInvalid: number } {
  const unique: T[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let droppedInvalid = 0;

  for (const hit of hits) {
    const domain = normalizeAgencyDomain(hit.url);
    if (!domain || !domain.includes('.')) {
      droppedInvalid += 1;
      continue;
    }
    if (seen.has(domain)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(domain);
    unique.push(hit);
  }

  return { unique, duplicateCount, droppedInvalid };
}
