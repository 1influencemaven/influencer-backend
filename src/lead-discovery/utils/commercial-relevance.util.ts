import { CommercialRelevance } from '../../generated/prisma/enums';

/**
 * Deterministic commercialRelevance classifier (ADR-0016).
 *
 * Orthogonal to isGeneric:
 * - isGeneric = company/role inbox (technical)
 * - commercialRelevance = outreach priority (business)
 *
 * Phase 0: util exists for domain/tests; discovery write-paths still persist UNKNOWN
 * until Contact Discovery 2A wires classification.
 */

const HIGH_LOCAL_PARTS = new Set([
  'partnerships',
  'partnership',
  'influencer',
  'influencers',
  'creator',
  'creators',
  'collab',
  'collabs',
  'collaborate',
  'collaborations',
  'affiliate',
  'affiliates',
  'press',
  'prensa',
  'marketing',
  // Brand commercial inboxes (generic but outreach-relevant)
  'info',
  'hello',
  'hola',
  'contact',
  'contacto',
  'business',
  'media',
  'ambassador',
  'ambassadors',
]);

const LOW_LOCAL_PARTS = new Set([
  'support',
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
  if (LOW_LOCAL_PARTS.has(local)) {
    return CommercialRelevance.LOW;
  }
  return CommercialRelevance.UNKNOWN;
}

export function normalizeBusinessEmail(email: string): string {
  return email.trim().toLowerCase();
}
