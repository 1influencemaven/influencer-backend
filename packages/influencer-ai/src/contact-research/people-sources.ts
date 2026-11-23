import type { BrightDataToolsClient } from '../brightdata/client';
import type { BrightDataOrganicHit } from '../brightdata/types';
import { normalizeLinkedInPeopleUrl } from './linkedin-profile-url';

/** Bright Data marketplace dataset "ZoomInfo companies information". */
export const ZOOMINFO_COMPANIES_DATASET_ID = 'gd_m0ci4a4ivx3j5l6nx';

/** Roles worth contacting for brand ↔ influencer collaborations. */
const USEFUL_ROLE =
  /influenc|creator|partnership|affiliate|ambassador|collab|\bpr\b|public relations|communications|social|brand|marketing|\bcmo\b|community|content|talent|growth|e-?commerce director|founder|co-?founder|\bceo\b/i;

/** Roles that never decide collaborations (store floor, back office, engineering). */
const USELESS_ROLE =
  /store|sales associate|retail associate|cashier|warehouse|stock|assistant manager|keyholder|merchandis(er|ing) associate|engineer|developer|accountant|finance|payroll|recruit|human resources|\bhr\b|customer (service|care|support)|logistics|operations associate|driver|intern\b/i;

/**
 * Pre-scrape check on the role parsed from a SERP title. "Name - X" titles are
 * ambiguous (X may be the company), so only clearly useless roles are dropped.
 */
export function isClearlyUselessRole(
  title: string | undefined | null,
): boolean {
  const role = title?.trim();
  return Boolean(role) && USELESS_ROLE.test(role!);
}

/**
 * True when the role can plausibly decide or route an influencer collaboration.
 * Unknown (empty) roles are kept: the brand match already tied the person.
 */
export function isUsefulRole(title: string | undefined | null): boolean {
  const role = title?.trim();
  if (!role) return true;
  if (USELESS_ROLE.test(role)) return false;
  return USEFUL_ROLE.test(role);
}

function sanitize(value: string): string {
  return value.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Google queries for LinkedIn people at a brand. Role groups use OR so each
 * SERP call covers several titles (the previous ladder spent its 4-query budget
 * on variations of a single role).
 */
export function buildLinkedInPeopleQueries(input: {
  brandName: string;
  priorityRoles?: string[];
  maxQueries?: number;
}): string[] {
  const brand = sanitize(input.brandName);
  if (!brand) return [];
  const custom = (input.priorityRoles ?? [])
    .map(sanitize)
    .filter(Boolean)
    .slice(0, 4)
    .map((r) => `"${r}"`);

  const queries = [
    ...(custom.length
      ? [`site:linkedin.com/in "${brand}" (${custom.join(' OR ')})`]
      : []),
    `site:linkedin.com/in "${brand}" (influencer OR creator OR partnerships OR affiliate OR ambassador)`,
    `site:linkedin.com/in "${brand}" (PR OR "public relations" OR communications OR "social media")`,
    `site:linkedin.com/in "${brand}" ("brand marketing" OR "marketing director" OR "head of marketing" OR CMO OR "marketing manager")`,
    `"${brand}" "influencer marketing" LinkedIn`,
    `site:linkedin.com/in "at ${brand}" marketing`,
  ];
  const unique = [...new Set(queries)];
  return unique.slice(0, Math.max(0, input.maxQueries ?? unique.length));
}

export type CompanyLeader = { name: string; title?: string };

function hostOf(value: string): string {
  try {
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Marketing/partnerships leaders from the ZoomInfo companies dataset (Filter
 * API by website). Names and titles only; ZoomInfo emails are not exposed.
 */
export async function fetchZoomInfoLeaders(
  client: BrightDataToolsClient,
  domain: string,
  limit = 3,
): Promise<{ leaders: CompanyLeader[]; error?: string }> {
  const host = domain.toLowerCase().replace(/^www\./, '');
  if (!host) return { leaders: [] };
  // Optional enrichment: a ZoomInfo failure must never fail the people search.
  let result: Awaited<ReturnType<BrightDataToolsClient['filterDatasetRows']>>;
  try {
    result = await client.filterDatasetRows(
      ZOOMINFO_COMPANIES_DATASET_ID,
      { name: 'website', operator: 'includes', value: host },
      3,
    );
  } catch (error) {
    return {
      leaders: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!result.ok) return { leaders: [], error: result.error };

  const row = result.rows.find(
    (r) => typeof r.website === 'string' && hostOf(r.website) === host,
  );
  const leadership = Array.isArray(row?.leadership) ? row.leadership : [];
  const leaders: CompanyLeader[] = [];
  for (const entry of leadership) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const title = typeof rec.title === 'string' ? rec.title.trim() : undefined;
    if (!name || !title || !isUsefulRole(title)) continue;
    leaders.push({ name, title });
    if (leaders.length >= limit) break;
  }
  return { leaders };
}

/**
 * LinkedIn profile for a named leader: first /in/ result whose title carries the
 * person's last name (one SERP call per leader).
 */
export async function findLeaderLinkedInHit(
  client: BrightDataToolsClient,
  leader: CompanyLeader,
  brandName: string,
): Promise<BrightDataOrganicHit | null> {
  const name = sanitize(leader.name);
  const lastName = name.split(' ').pop()?.toLowerCase() ?? '';
  if (!name || lastName.length < 2) return null;
  let serp: Awaited<ReturnType<BrightDataToolsClient['searchWeb']>>;
  try {
    serp = await client.searchWeb(
      `site:linkedin.com/in "${name}" "${sanitize(brandName)}"`,
      5,
    );
  } catch {
    return null;
  }
  if (!serp.ok) return null;
  for (const hit of serp.organics) {
    if (!normalizeLinkedInPeopleUrl(hit.url)) continue;
    if (hit.title.toLowerCase().includes(lastName)) return hit;
  }
  return null;
}
