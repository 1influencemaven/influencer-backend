import { CommercialRelevance } from '../../generated/prisma/enums';

/**
 * Deterministic commercialRelevance classifier (ADR-0016 + RF-02).
 *
 * Orthogonal to isGeneric:
 * - isGeneric = company/role inbox (technical)
 * - commercialRelevance = outreach priority (business)
 *
 * Prisma enum mapping (no migration):
 * - HIGH     → partnerships / creators / influencer collab (RF-02 HIGH)
 * - NEUTRAL  → marketing / press / affiliate (RF-02 MEDIUM)
 * - UNKNOWN  → info / hello / contact (RF-02 GENERAL)
 * - LOW      → support / help (RF-02 LOW)
 * noreply is EXCLUDED at extract/domain gates, not persisted as outreach-ready.
 */

const HIGH_LOCAL_PARTS = new Set([
  'partnerships',
  'partnership',
  'partner',
  'influencer',
  'influencers',
  'creator',
  'creators',
  'collab',
  'collabs',
  'collaborate',
  'collaboration',
  'collaborations',
  'ambassador',
  'ambassadors',
]);

/** RF-02 MEDIUM — stored as NEUTRAL in Prisma. */
const MEDIUM_LOCAL_PARTS = new Set([
  'marketing',
  'affiliate',
  'affiliates',
  'press',
  'prensa',
  'media',
  'newsroom',
]);

/** RF-02 GENERAL — stored as UNKNOWN in Prisma. */
const GENERAL_LOCAL_PARTS = new Set([
  'info',
  'hello',
  'hola',
  'contact',
  'contacto',
  'business',
]);

const LOW_LOCAL_PARTS = new Set([
  'support',
  'soporte',
  'help',
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
]);

function localPart(email: string): string | null {
  const local = email.split('@')[0]?.toLowerCase().trim();
  return local || null;
}

export function classifyCommercialRelevance(
  email: string,
): CommercialRelevance {
  const local = localPart(email);
  if (!local) {
    return CommercialRelevance.UNKNOWN;
  }
  if (HIGH_LOCAL_PARTS.has(local)) {
    return CommercialRelevance.HIGH;
  }
  if (MEDIUM_LOCAL_PARTS.has(local)) {
    return CommercialRelevance.NEUTRAL;
  }
  if (LOW_LOCAL_PARTS.has(local)) {
    return CommercialRelevance.LOW;
  }
  if (GENERAL_LOCAL_PARTS.has(local)) {
    return CommercialRelevance.UNKNOWN;
  }
  return CommercialRelevance.UNKNOWN;
}

/**
 * RF-02 / RF-02.1 display + metrics tier (orthogonal to Prisma enum storage).
 * OTHER = not a known commercial mailbox local-part (may look person-like);
 * never collapse OTHER into GENERAL.
 */
export type CommercialCoverageTier =
  | 'HIGH'
  | 'MEDIUM'
  | 'GENERAL'
  | 'LOW'
  | 'OTHER';

export function commercialCoverageTier(
  email: string,
): CommercialCoverageTier {
  const local = localPart(email);
  if (!local) return 'OTHER';
  if (HIGH_LOCAL_PARTS.has(local)) return 'HIGH';
  if (MEDIUM_LOCAL_PARTS.has(local)) return 'MEDIUM';
  if (GENERAL_LOCAL_PARTS.has(local)) return 'GENERAL';
  if (LOW_LOCAL_PARTS.has(local)) return 'LOW';
  return 'OTHER';
}

/** Map persisted Prisma relevance → functional tier for historical rows without email parse edge cases. */
export function commercialCoverageTierFromRelevance(
  relevance: CommercialRelevance,
  email: string,
): CommercialCoverageTier {
  const fromEmail = commercialCoverageTier(email);
  // Prefer literal local-part classification when known.
  if (fromEmail !== 'OTHER') {
    return fromEmail;
  }
  // Historical / person-like: do not label as GENERAL just because Prisma UNKNOWN.
  switch (relevance) {
    case CommercialRelevance.HIGH:
      return 'HIGH';
    case CommercialRelevance.NEUTRAL:
      return 'MEDIUM';
    case CommercialRelevance.LOW:
      return 'LOW';
    case CommercialRelevance.UNKNOWN:
    default:
      return 'OTHER';
  }
}

export function normalizeBusinessEmail(email: string): string {
  return email.trim().toLowerCase();
}
