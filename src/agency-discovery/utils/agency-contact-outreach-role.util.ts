/**
 * 2C.4.3 — outreachRole labels for agency commercial mailboxes (metadata only).
 * Orthogonal to Prisma CommercialRelevance and AgencyRelevanceStatus.
 * Never infers a person from the local-part.
 */

const LOCAL_TO_OUTREACH_ROLE: Record<string, string> = {
  partnerships: 'Partnerships',
  partnership: 'Partnerships',
  partner: 'Partnerships',
  influencer: 'Influencer Marketing',
  influencers: 'Influencer Marketing',
  creator: 'Creator Relations',
  creators: 'Creator Relations',
  collab: 'Partnerships',
  collabs: 'Partnerships',
  collaborate: 'Partnerships',
  collaboration: 'Partnerships',
  collaborations: 'Partnerships',
  talent: 'Talent Partnerships',
  talents: 'Talent Partnerships',
  campaign: 'Campaign Management',
  campaigns: 'Campaign Management',
  marketing: 'Marketing',
  press: 'Marketing',
  media: 'Marketing',
  info: 'General',
  hello: 'General',
  hola: 'General',
  contact: 'General',
  contacto: 'General',
  business: 'General',
  support: 'Support',
  soporte: 'Support',
  help: 'Support',
  noreply: 'No-reply',
  'no-reply': 'No-reply',
  donotreply: 'No-reply',
  'do-not-reply': 'No-reply',
};

export function outreachRoleFromEmailLocalPart(
  email: string,
): string | undefined {
  const local = email.split('@')[0]?.toLowerCase().trim();
  if (!local) return undefined;
  return LOCAL_TO_OUTREACH_ROLE[local];
}
