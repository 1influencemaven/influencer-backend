/** Default roles for Track 2B person SERP (Outreach / legacy lead discovery). */
export const DEFAULT_PERSON_PRIORITY_ROLES = [
  'Influencer Marketing Manager',
  'Brand Partnerships',
  'Creator Partnerships',
  'Influencer Marketing',
  'Partnerships',
  'CMO',
] as const;

export type PersonQueryLadderInput = {
  brandName: string;
  priorityRoles?: string[];
  /** Cap total queries returned (SERP budget). */
  maxQueries?: number;
};

function sanitizeQueryFragment(value: string): string {
  return value
    .replace(/["\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic Google queries aimed at LinkedIn people for a brand.
 * Port of Nest PersonQueryLadderBuilder (pre-Paso 5b delete).
 */
export function buildPersonQueryLadder(input: PersonQueryLadderInput): string[] {
  const brand = sanitizeQueryFragment(input.brandName);
  if (!brand) return [];

  const roles = mergeRoles(input.priorityRoles);
  const queries: string[] = [];
  const seen = new Set<string>();

  for (const role of roles) {
    const r = sanitizeQueryFragment(role);
    if (!r) continue;
    pushUnique(queries, seen, `"${brand}" "${r}"`);
    pushUnique(queries, seen, `"${brand}" "${r}" LinkedIn`);
    pushUnique(queries, seen, `site:linkedin.com/in "${brand}" "${r}"`);
  }

  pushUnique(queries, seen, `"${brand}" influencer marketing`);
  pushUnique(queries, seen, `"${brand}" partnerships LinkedIn`);
  pushUnique(
    queries,
    seen,
    `"${brand}" "Influencer Marketing Manager" LinkedIn`,
  );
  pushUnique(
    queries,
    seen,
    `"${brand}" "Brand Partnerships" OR "Creator Partnerships" LinkedIn`,
  );

  const max = input.maxQueries ?? queries.length;
  return queries.slice(0, Math.max(0, max));
}

function mergeRoles(priorityRoles?: string[]): string[] {
  const merged = [...(priorityRoles ?? []), ...DEFAULT_PERSON_PRIORITY_ROLES];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of merged) {
    const key = role.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(role.trim());
    if (out.length >= 6) break;
  }
  return out;
}

function pushUnique(queries: string[], seen: Set<string>, query: string): void {
  const key = query.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  queries.push(query);
}
