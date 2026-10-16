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

export function extractEmailDomain(email: string): string | null {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  return domain || null;
}

export function isFreeMailDomain(email: string): boolean {
  const domain = extractEmailDomain(email);
  if (!domain) {
    return false;
  }
  return FREE_MAIL_DOMAINS.has(domain);
}

/**
 * Brand domain or subdomain of brand domain (e.g. mail.brand.com under brand.com).
 */
export function isBrandDomainEmail(
  email: string,
  brandDomain: string,
): boolean {
  const emailDomain = extractEmailDomain(email);
  const brand = brandDomain.trim().toLowerCase().replace(/^www\./, '');
  if (!emailDomain || !brand) {
    return false;
  }
  return emailDomain === brand || emailDomain.endsWith(`.${brand}`);
}

/**
 * Phase 2A attribution gate:
 * - brand domain/subdomain → allow
 * - free-mail → allow (no ownership claim; evidence required upstream)
 * - other external (agency, third-party corp) → reject
 */
export function isAllowedBrandBusinessContactEmailDomain(
  email: string,
  brandDomain: string,
): boolean {
  if (isBrandDomainEmail(email, brandDomain)) {
    return true;
  }
  if (isFreeMailDomain(email)) {
    return true;
  }
  return false;
}

export function labelFromEmailLocalPart(email: string): string | null {
  const local = email.split('@')[0]?.trim();
  if (!local) {
    return null;
  }
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
}
