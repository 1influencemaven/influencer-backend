import type { BrightDataOrganicHit } from '../brightdata/types';
import { normalizeLinkedInPeopleUrl } from './linkedin-profile-url';

/**
 * Track 2B selection: a LinkedIn profile is only worth scraping when Google's
 * own title/snippet ties it to the brand. Collecting every `/in/` URL from the
 * SERP produced unrelated people (same first name, other countries).
 */

export type LinkedInPeopleHit = {
  url: string;
  serpTitle: string;
  serpSnippet: string;
  /** Number of priority-role keywords in title/snippet (ranking only). */
  roleScore: number;
};

function compact(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Brand tokens worth matching: compact brand name and domain label (≥ 3 chars). */
export function brandMatchKeys(brandName: string, domain: string): string[] {
  const label =
    domain
      .toLowerCase()
      .replace(/^www\./, '')
      .split('.')[0] ?? '';
  return [...new Set([compact(brandName), compact(label)])].filter(
    (key) => key.length >= 3,
  );
}

export function textMentionsBrand(
  text: string | undefined | null,
  keys: readonly string[],
): boolean {
  if (!text) return false;
  const haystack = compact(text);
  return keys.some((key) => haystack.includes(key));
}

const ROLE_WORDS =
  /\b(influencer|creator|partnership|partnerships|affiliate|ambassador|social|pr|public relations|brand marketing|marketing|community|cmo)\b/gi;

/** "Jane Doe - Role - Company | LinkedIn" → "Company" (only with 3+ segments). */
export function companyFromSerpTitle(serpTitle: string): string | undefined {
  const withoutSuffix = serpTitle.replace(/\s*[|·]\s*linkedin.*$/i, '').trim();
  const parts = withoutSuffix.split(/\s+[-–—]\s+/).map((p) => p.trim());
  return parts.length >= 3 ? parts[parts.length - 1] : undefined;
}

/** "Experience: Gorjana · Education: …" → "Gorjana". */
function experienceFromSnippet(snippet: string): string | undefined {
  const match = snippet.match(/experience:\s*([^·|\n]+)/i);
  return match?.[1]?.trim() || undefined;
}

/**
 * Pre-scrape rejection (saves a ~60 s LinkedIn scrape): Google already says the
 * person works elsewhere — the title's company segment, or the snippet's
 * "Experience:", names another company and neither names the brand.
 */
function serpNamesOtherCompany(
  hit: BrightDataOrganicHit,
  keys: readonly string[],
): boolean {
  const declared = [
    companyFromSerpTitle(hit.title),
    experienceFromSnippet(hit.snippet),
  ].filter((c): c is string => Boolean(c));
  if (declared.length === 0) return false;
  return !declared.some((company) => textMentionsBrand(company, keys));
}

export function selectLinkedInPeopleHits(
  organics: readonly BrightDataOrganicHit[],
  params: { brandName: string; domain: string; limit: number },
): LinkedInPeopleHit[] {
  const keys = brandMatchKeys(params.brandName, params.domain);
  const byUrl = new Map<string, LinkedInPeopleHit>();
  for (const hit of organics) {
    const url = normalizeLinkedInPeopleUrl(hit.url);
    if (!url) continue;
    const key = url.toLowerCase();
    if (byUrl.has(key)) continue;
    const blob = `${hit.title}\n${hit.snippet}`;
    if (!textMentionsBrand(blob, keys)) continue;
    if (serpNamesOtherCompany(hit, keys)) continue;
    byUrl.set(key, {
      url,
      serpTitle: hit.title,
      serpSnippet: hit.snippet,
      roleScore: (blob.match(ROLE_WORDS) ?? []).length,
    });
  }
  return [...byUrl.values()]
    .sort((a, b) => b.roleScore - a.roleScore)
    .slice(0, Math.max(0, params.limit));
}

function companyNamesFromRow(
  row: Record<string, unknown> | undefined,
): string[] {
  if (!row) return [];
  const names: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) names.push(value.trim());
  };
  push(row.current_company_name);
  const current = row.current_company;
  if (current && typeof current === 'object') {
    push((current as Record<string, unknown>).name);
  } else {
    push(current);
  }
  const experience = Array.isArray(row.experience) ? row.experience : [];
  const first = experience[0];
  if (first && typeof first === 'object') {
    push((first as Record<string, unknown>).company);
  }
  return names;
}

/**
 * Post-scrape check. When the dataset names a current company, it must be the
 * brand (or the headline/about must mention it). Without company data the SERP
 * pre-filter already tied the profile to the brand.
 */
export function profileBelongsToBrand(
  scraped: { title?: string; about?: string; raw?: Record<string, unknown> },
  keys: readonly string[],
): boolean {
  const companies = companyNamesFromRow(scraped.raw);
  if (companies.some((c) => textMentionsBrand(c, keys))) return true;
  if (textMentionsBrand(scraped.title, keys)) return true;
  if (companies.length === 0) return true;
  return textMentionsBrand(scraped.about, keys);
}

/**
 * Role from a LinkedIn SERP title: "Jane Doe - Influencer Marketing Manager - Gorjana | LinkedIn".
 */
export function roleFromSerpTitle(serpTitle: string): string | undefined {
  const withoutSuffix = serpTitle.replace(/\s*[|·]\s*linkedin.*$/i, '').trim();
  const parts = withoutSuffix.split(/\s+[-–—]\s+/).map((p) => p.trim());
  if (parts.length < 2) return undefined;
  const role = parts[1];
  return role && role.length <= 120 ? role : undefined;
}

/** Role from the dataset row when `position`/`headline` are empty. */
export function roleFromRow(
  row: Record<string, unknown> | undefined,
): string | undefined {
  const experience = Array.isArray(row?.experience) ? row.experience : [];
  const first = experience[0];
  if (first && typeof first === 'object') {
    const title = (first as Record<string, unknown>).title;
    if (typeof title === 'string' && title.trim()) return title.trim();
  }
  return undefined;
}
