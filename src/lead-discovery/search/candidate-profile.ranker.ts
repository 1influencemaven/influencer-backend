import type {
  LinkedInCandidate,
  SearchProviderId,
  SearchResultItem,
} from '../interfaces/lead-search.interface';
import {
  extractLinkedInSlug,
  normalizePeopleLinkedInUrl,
} from '../utils/linkedin-url.util';
import { slugSimilarityScore, normalizeNameToSlug } from '../utils/slug-match.util';

export type RankCandidatesInput = {
  items: SearchResultItem[];
  query: string;
  provider: SearchProviderId;
  brandName: string;
  roleKeywords?: string[];
  expectedPersonName?: string;
};

const SCORE_THRESHOLD = 35;

export class CandidateProfileRanker {
  rank(input: RankCandidatesInput): LinkedInCandidate[] {
    const brand = input.brandName.trim().toLowerCase();
    const roleKeywords = (input.roleKeywords ?? []).map((r) =>
      r.trim().toLowerCase(),
    );
    const expectedSlug = input.expectedPersonName
      ? normalizeNameToSlug(input.expectedPersonName)
      : null;

    const candidates: LinkedInCandidate[] = [];

    for (const item of input.items) {
      const normalizedUrl = normalizePeopleLinkedInUrl(item.url);
      if (!normalizedUrl) {
        continue;
      }

      const slug = extractLinkedInSlug(normalizedUrl);
      if (!slug) {
        continue;
      }

      const blob = `${item.title} ${item.snippet}`.toLowerCase();
      let score = 0;
      const reasons: string[] = ['linkedin_in_path'];

      if (item.position <= 3) {
        score += 15 - (item.position - 1) * 5;
        reasons.push(`position_${item.position}`);
      }

      if (brand && blob.includes(brand)) {
        score += 25;
        reasons.push('brand_match');
      }

      const roleHit = roleKeywords.some(
        (role) => role.length > 2 && blob.includes(role),
      );
      if (roleHit) {
        score += 20;
        reasons.push('role_match');
      }

      if (expectedSlug) {
        const similarity = slugSimilarityScore(expectedSlug, slug);
        if (similarity >= 0.85) {
          score += 20;
          reasons.push('slug_match');
        } else if (similarity >= 0.5) {
          score += 10;
          reasons.push('slug_partial');
        }
      }

      candidates.push({
        url: normalizedUrl,
        score,
        reasons,
        searchPosition: item.position,
        query: input.query,
        provider: input.provider,
        title: item.title,
        snippet: item.snippet,
      });
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  filterByThreshold(candidates: LinkedInCandidate[]): LinkedInCandidate[] {
    return candidates.filter((c) => c.score >= SCORE_THRESHOLD);
  }

  dedupeCandidates(candidates: LinkedInCandidate[]): LinkedInCandidate[] {
    const byUrl = new Map<string, LinkedInCandidate>();
    for (const candidate of candidates) {
      const existing = byUrl.get(candidate.url);
      if (!existing || candidate.score > existing.score) {
        byUrl.set(candidate.url, candidate);
      }
    }
    return [...byUrl.values()].sort((a, b) => b.score - a.score);
  }
}
