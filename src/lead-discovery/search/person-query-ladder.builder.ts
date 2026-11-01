import { DEFAULT_LEAD_PRIORITY_ROLES } from '../../ai/prompts/generate-lead-discovery.prompt';
import { sanitizeQueryFragment } from '../utils/query-sanitize.util';

export type PersonQueryLadderInput = {
  brandName: string;
  priorityRoles?: string[];
};

export class PersonQueryLadderBuilder {
  build(input: PersonQueryLadderInput): string[] {
    const brand = sanitizeQueryFragment(input.brandName);
    if (!brand) {
      return [];
    }

    const roles = this.mergeRoles(input.priorityRoles);
    const queries: string[] = [];
    const seen = new Set<string>();

    for (const role of roles) {
      const r = sanitizeQueryFragment(role);
      if (!r) {
        continue;
      }
      this.pushUnique(queries, seen, `"${brand}" "${r}"`);
      this.pushUnique(queries, seen, `"${brand}" "${r}" LinkedIn`);
      this.pushUnique(
        queries,
        seen,
        `site:linkedin.com/in "${brand}" "${r}"`,
      );
    }

    this.pushUnique(queries, seen, `"${brand}" influencer marketing`);
    this.pushUnique(queries, seen, `"${brand}" partnerships LinkedIn`);
    this.pushUnique(
      queries,
      seen,
      `"${brand}" "Influencer Marketing Manager" LinkedIn`,
    );
    this.pushUnique(
      queries,
      seen,
      `"${brand}" "Brand Partnerships" OR "Creator Partnerships" LinkedIn`,
    );

    return queries;
  }

  private mergeRoles(priorityRoles?: string[]): string[] {
    const merged = [...(priorityRoles ?? []), ...DEFAULT_LEAD_PRIORITY_ROLES];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const role of merged) {
      const key = role.trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(role.trim());
      if (out.length >= 6) {
        break;
      }
    }
    return out;
  }

  private pushUnique(
    queries: string[],
    seen: Set<string>,
    query: string,
  ): void {
    const key = query.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    queries.push(query);
  }
}
