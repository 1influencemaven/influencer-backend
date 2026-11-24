/**
 * Target roles for brand ↔ influencer collaborations (enrichment strategy §4).
 * Search is free, so the keyword list is wide; credits are only spent on the
 * best-ranked people.
 */
export const SALESHANDY_TITLE_KEYWORDS = [
  'influencer',
  'creator',
  'partnership',
  'talent',
  'affiliate',
  'ambassador',
  'collab',
  'community',
  'PR',
  'public relations',
  'communications',
  'social media',
  'brand',
  'marketing',
  'CMO',
  'growth',
  'founder',
];

const TIERS: ReadonlyArray<{ score: number; re: RegExp }> = [
  {
    score: 100,
    re: /influenc|creator|partnership|talent|affiliate|ambassador|collab/i,
  },
  {
    score: 80,
    re: /\bpr\b|public relations|communications|social media|community/i,
  },
  {
    score: 60,
    re: /brand marketing|head of marketing|(director|vp|vice president)( of)? (brand|marketing)|marketing director|\bcmo\b|chief marketing|head of (brand|growth)/i,
  },
  { score: 40, re: /brand manager|marketing manager|\bbrand\b/i },
  { score: 35, re: /founder|\bceo\b|owner|president/i },
  { score: 20, re: /marketing/i },
];

/** Marketing roles that never decide creator collaborations. */
const EXCLUDED =
  /design|educator|artist|stylist|photograph|videograph|editor\b|copywrit|lifecycle|performance|e-?mail|\bcrm\b|\bseo\b|\bsem\b|paid|media buy|analytics|data|ecommerce operations|retail operations|store|sales associate|engineer|developer|finance|account(ant|ing)|recruit|human resources|\bhr\b|customer (service|care|support)|intern\b/i;

/** People who ARE the creator/ambassador (employees), not who manages them. */
const PERFORMER = /brand ambassador|content creator|ugc creator|\bcreator\b|\bambassador\b/i;
const MANAGES = /manag|lead\b|head|director|coordinator|program|specialist|partnership|\bvp\b|chief/i;

/** 0 = do not spend credits on this person. */
export function rankCollaborationRole(
  title: string | undefined | null,
  decisionMaker = false,
): number {
  const role = title?.trim();
  if (!role || EXCLUDED.test(role)) return 0;
  if (PERFORMER.test(role) && !MANAGES.test(role)) return 0;
  const base = TIERS.find((tier) => tier.re.test(role))?.score ?? 0;
  if (base === 0) return 0;
  return base + (decisionMaker ? 10 : 0);
}

/** High-priority roles (strategy Tier 1 allowlist "Prioridad Alta"). */
export function isPriorityCollaborationRole(
  title: string | undefined | null,
): boolean {
  return rankCollaborationRole(title) >= 80;
}
