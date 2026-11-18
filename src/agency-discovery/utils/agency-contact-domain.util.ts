import {
  extractEmailDomain,
  isBlockedBrandBusinessContactLocalPart,
  isFreeMailDomain,
  normalizeHostname,
  hostnameFromUrlOrHost,
} from '../../lead-discovery/utils/brand-business-contact-domain.util';
import { normalizeAgencyDomain } from '../../lead-discovery/utils/agency-domain.util';

/**
 * 2C.4.3 — RF-01-style domain gate for AgencyContact.
 * Subject host is Agency.domain (normalized). Same subdomain policy as BBC:
 * mail.agency.com is allowed under agency.com; sibling corp domains need
 * explicit corroboration (not textual similarity).
 */

export type AgencyEmailDomainAllowReason =
  | 'agency_domain'
  | 'corroborated_domain';

export type AgencyEmailDomainRejectReason =
  | 'free_mail'
  | 'external_domain'
  | 'blocked_local'
  | 'invalid';

export type AgencyEmailDomainAssessment =
  | { decision: 'allow'; reason: AgencyEmailDomainAllowReason }
  | { decision: 'reject'; reason: AgencyEmailDomainRejectReason };

/**
 * Official / corroborated hosts for an agency (RF-01 pattern).
 * Always includes agencyDomain + website host when present.
 */
export function buildCorroboratedAgencyDomains(params: {
  agencyDomain: string;
  website?: string | null;
  additionalDomains?: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined) => {
    if (!value) return;
    const host =
      normalizeAgencyDomain(value) ||
      normalizeHostname(value) ||
      hostnameFromUrlOrHost(value);
    if (!host || seen.has(host)) return;
    seen.add(host);
    out.push(host);
  };

  push(params.agencyDomain);
  if (params.website) {
    push(params.website);
  }
  for (const extra of params.additionalDomains ?? []) {
    push(extra);
  }
  return out;
}

/**
 * Agency domain or subdomain of agency domain (e.g. mail.agency.com).
 * Does NOT treat "agency-brand.com" as belonging to "agency.com".
 */
export function isAgencyDomainEmail(
  email: string,
  agencyDomain: string,
): boolean {
  const emailDomain = extractEmailDomain(email);
  const agency = normalizeAgencyDomain(agencyDomain) || normalizeHostname(agencyDomain);
  if (!emailDomain || !agency) {
    return false;
  }
  return emailDomain === agency || emailDomain.endsWith(`.${agency}`);
}

/**
 * Gate order mirrors assessBrandBusinessContactEmailDomain:
 * invalid → blocked_local → agency_domain → free_mail → corroborated → external.
 */
export function assessAgencyContactEmailDomain(
  email: string,
  agencyDomain: string,
  corroboratedDomains: string[] = [],
): AgencyEmailDomainAssessment {
  if (!email.includes('@')) {
    return { decision: 'reject', reason: 'invalid' };
  }
  if (isBlockedBrandBusinessContactLocalPart(email)) {
    return { decision: 'reject', reason: 'blocked_local' };
  }
  if (isAgencyDomainEmail(email, agencyDomain)) {
    return { decision: 'allow', reason: 'agency_domain' };
  }
  const emailDomain = extractEmailDomain(email);
  if (!emailDomain) {
    return { decision: 'reject', reason: 'invalid' };
  }
  if (isFreeMailDomain(email)) {
    return { decision: 'reject', reason: 'free_mail' };
  }

  const allowed = new Set(
    buildCorroboratedAgencyDomains({
      agencyDomain,
      additionalDomains: corroboratedDomains,
    }),
  );
  for (const host of allowed) {
    if (emailDomain === host || emailDomain.endsWith(`.${host}`)) {
      return { decision: 'allow', reason: 'corroborated_domain' };
    }
  }
  return { decision: 'reject', reason: 'external_domain' };
}

export function isAllowedAgencyContactEmailDomain(
  email: string,
  agencyDomain: string,
  corroboratedDomains: string[] = [],
): boolean {
  return (
    assessAgencyContactEmailDomain(email, agencyDomain, corroboratedDomains)
      .decision === 'allow'
  );
}
