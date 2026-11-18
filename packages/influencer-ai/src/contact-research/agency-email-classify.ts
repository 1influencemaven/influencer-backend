/**
 * Lightweight mailbox classification for FIND_AGENCY_EMAILS output.
 * Nest remains authoritative for domain gates / persistence (2C.4.5).
 * Does not invent persons from local-part. Never sets VERIFIED.
 */

const EXCLUDED_LOCALS = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'support',
  'soporte',
  'help',
]);

const HIGH_LOCALS = new Set([
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
  'talent',
  'talents',
  'campaign',
  'campaigns',
  'ambassador',
  'ambassadors',
]);

const MEDIUM_LOCALS = new Set([
  'marketing',
  'press',
  'prensa',
  'media',
  'newsroom',
  'affiliate',
  'affiliates',
]);

const GENERAL_LOCALS = new Set([
  'info',
  'hello',
  'hola',
  'contact',
  'contacto',
  'business',
]);

const OUTREACH_ROLE: Record<string, string> = {
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
};

function localPart(email: string): string | null {
  const local = email.split('@')[0]?.toLowerCase().trim();
  return local || null;
}

export function isExcludedAgencyMailboxLocal(email: string): boolean {
  const local = localPart(email);
  return Boolean(local && EXCLUDED_LOCALS.has(local));
}

/** Agency domain or subdomain — runner-side filter before Nest gate. */
export function isEmailOnAgencyDomain(email: string, agencyDomain: string): boolean {
  const emailDomain = email.split('@')[1]?.trim().toLowerCase();
  const agency = agencyDomain.trim().toLowerCase().replace(/^www\./, '');
  if (!emailDomain || !agency) return false;
  return emailDomain === agency || emailDomain.endsWith(`.${agency}`);
}

export type AgencyMailboxCommercialRelevance =
  | 'HIGH'
  | 'NEUTRAL'
  | 'LOW'
  | 'UNKNOWN';

export function classifyAgencyMailboxRelevance(
  email: string,
): AgencyMailboxCommercialRelevance {
  const local = localPart(email);
  if (!local) return 'UNKNOWN';
  if (HIGH_LOCALS.has(local)) return 'HIGH';
  if (MEDIUM_LOCALS.has(local)) return 'NEUTRAL';
  if (EXCLUDED_LOCALS.has(local)) return 'LOW';
  if (GENERAL_LOCALS.has(local)) return 'UNKNOWN';
  return 'UNKNOWN';
}

export function isLikelyGenericAgencyMailbox(email: string): boolean {
  const local = localPart(email);
  if (!local) return false;
  return (
    HIGH_LOCALS.has(local) ||
    MEDIUM_LOCALS.has(local) ||
    GENERAL_LOCALS.has(local) ||
    EXCLUDED_LOCALS.has(local)
  );
}

export function outreachRoleForAgencyMailbox(
  email: string,
): string | undefined {
  const local = localPart(email);
  if (!local) return undefined;
  return OUTREACH_ROLE[local];
}
