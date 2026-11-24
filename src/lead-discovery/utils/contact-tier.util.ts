import {
  CommercialRelevance,
  LeadEmailConfidence,
} from '../../generated/prisma/enums';
import { commercialCoverageTier } from './commercial-relevance.util';

/**
 * Contact value tiers (enrichment strategy §3), derived — never stored:
 * - TIER_1  verified nominal email (Saleshandy valid / catch-all)
 * - TIER_2  area mailbox (partnerships@, press@, marketing@ …)
 * - TIER_3  person without a verified email (LinkedIn / DM queue)
 * - GENERIC info@ / hello@ / support@ — kept per brand as last resort
 * - REJECTED undeliverable, nothing usable
 */
export type ContactTier =
  | 'TIER_1'
  | 'TIER_2'
  | 'TIER_3'
  | 'GENERIC'
  | 'REJECTED';

export const CONTACT_TIER_ORDER: Record<ContactTier, number> = {
  TIER_1: 0,
  TIER_2: 1,
  TIER_3: 2,
  GENERIC: 3,
  REJECTED: 4,
};

function mailboxTier(email: string): ContactTier {
  const tier = commercialCoverageTier(email);
  return tier === 'HIGH' || tier === 'MEDIUM' ? 'TIER_2' : 'GENERIC';
}

export function leadContactTier(lead: {
  email: string | null;
  emailConfidence: LeadEmailConfidence;
  isGeneric: boolean;
  profileUrl: string | null;
}): ContactTier {
  const hasEmail = Boolean(lead.email);
  if (!hasEmail || lead.emailConfidence === LeadEmailConfidence.INVALID) {
    return lead.profileUrl ? 'TIER_3' : 'REJECTED';
  }
  if (lead.isGeneric) return mailboxTier(lead.email!);
  if (
    lead.emailConfidence === LeadEmailConfidence.VALID ||
    lead.emailConfidence === LeadEmailConfidence.PROBABLE
  ) {
    return 'TIER_1';
  }
  // Nominal but unverified: not outreach-ready until a verifier confirms it.
  return 'TIER_3';
}

export function businessContactTier(contact: {
  email: string;
  commercialRelevance: CommercialRelevance;
}): ContactTier {
  if (contact.commercialRelevance === CommercialRelevance.HIGH) return 'TIER_2';
  if (contact.commercialRelevance === CommercialRelevance.NEUTRAL) return 'TIER_2';
  return mailboxTier(contact.email);
}
