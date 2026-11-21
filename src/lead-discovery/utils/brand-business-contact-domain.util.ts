const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.es',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
]);

/** Local-parts that must never become BrandBusinessContact. */
const BLOCKED_BBC_LOCAL_PARTS = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
]);

export function extractEmailDomain(email: string): string | null {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  return domain || null;
}

export function normalizeHostname(hostOrDomain: string): string {
  return hostOrDomain.trim().toLowerCase().replace(/^www\./, '');
}

export function isFreeMailDomain(email: string): boolean {
  const domain = extractEmailDomain(email);
  if (!domain) {
    return false;
  }
  return FREE_MAIL_DOMAINS.has(domain);
}

export function isBlockedBrandBusinessContactLocalPart(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase().trim();
  return Boolean(local && BLOCKED_BBC_LOCAL_PARTS.has(local));
}

/**
 * Brand domain or subdomain of brand domain (e.g. mail.brand.com under brand.com).
 */
export function isBrandDomainEmail(
  email: string,
  brandDomain: string,
): boolean {
  const emailDomain = extractEmailDomain(email);
  const brand = normalizeHostname(brandDomain);
  if (!emailDomain || !brand) {
    return false;
  }
  return emailDomain === brand || emailDomain.endsWith(`.${brand}`);
}

export function hostnameFromUrlOrHost(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return normalizeHostname(new URL(withProtocol).hostname);
  } catch {
    return null;
  }
}

/**
 * Build the set of official/corroborated hosts for a brand (RF-01).
 * Always includes brandDomain + website host when present; callers may pass
 * additional corroborated alternate corporate domains (regional/parent).
 */
export function buildCorroboratedBrandDomains(params: {
  brandDomain: string;
  website?: string | null;
  additionalDomains?: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined) => {
    if (!value) return;
    const host = normalizeHostname(value);
    if (!host || seen.has(host)) return;
    seen.add(host);
    out.push(host);
  };

  push(params.brandDomain);
  if (params.website) {
    push(hostnameFromUrlOrHost(params.website));
  }
  for (const extra of params.additionalDomains ?? []) {
    push(hostnameFromUrlOrHost(extra) ?? normalizeHostname(extra));
  }
  return out;
}

export type BrandEmailDomainAllowReason =
  | 'brand_domain'
  | 'corroborated_domain';

export type BrandEmailDomainRejectReason =
  | 'free_mail'
  | 'external_domain'
  | 'blocked_local'
  | 'invalid';

export type BrandEmailDomainAssessment =
  | { decision: 'allow'; reason: BrandEmailDomainAllowReason }
  | { decision: 'reject'; reason: BrandEmailDomainRejectReason };

/**
 * RF-01 attribution gate for BrandBusinessContact:
 * - brand domain/subdomain → allow (ATTRIBUTED)
 * - corroborated alternate corporate domains → allow (ATTRIBUTED)
 * - free-mail → reject (not a brand corporate inbox)
 * - other external corp/agency → reject unless corroborated
 */
export function assessBrandBusinessContactEmailDomain(
  email: string,
  brandDomain: string,
  corroboratedDomains: string[] = [],
): BrandEmailDomainAssessment {
  if (!email.includes('@')) {
    return { decision: 'reject', reason: 'invalid' };
  }
  if (isBlockedBrandBusinessContactLocalPart(email)) {
    return { decision: 'reject', reason: 'blocked_local' };
  }
  if (isBrandDomainEmail(email, brandDomain)) {
    return { decision: 'allow', reason: 'brand_domain' };
  }
  const emailDomain = extractEmailDomain(email);
  if (!emailDomain) {
    return { decision: 'reject', reason: 'invalid' };
  }
  if (isFreeMailDomain(email)) {
    return { decision: 'reject', reason: 'free_mail' };
  }

  const allowed = new Set(
    buildCorroboratedBrandDomains({
      brandDomain,
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

/**
 * Convenience boolean for the RF-01 BBC domain gate.
 * Free-mail is NOT allowed as a brand business contact (ownership claim).
 */
export function isAllowedBrandBusinessContactEmailDomain(
  email: string,
  brandDomain: string,
  corroboratedDomains: string[] = [],
): boolean {
  return (
    assessBrandBusinessContactEmailDomain(
      email,
      brandDomain,
      corroboratedDomains,
    ).decision === 'allow'
  );
}

export function labelFromEmailLocalPart(email: string): string | null {
  const local = email.split('@')[0]?.trim();
  if (!local) {
    return null;
  }
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
}
