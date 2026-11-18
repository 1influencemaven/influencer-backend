import { classifyPublicEmailGeneric } from './public-email-generic.util';

/**
 * Functional discovery / attribution / verification concepts for RF-01.
 * Stored in BBC / channel metadata — no Prisma enum migration.
 *
 * - FOUND: literal email observed in a source
 * - ATTRIBUTED: enough evidence to associate to brand (or person)
 * - VERIFIED: reserved for a real mailbox verification result (not used yet)
 */
export const CONTACT_EMAIL_DISCOVERY_STATUS = {
  FOUND: 'FOUND',
} as const;

export const CONTACT_EMAIL_ATTRIBUTION_STATUS = {
  ATTRIBUTED: 'ATTRIBUTED',
  UNATTRIBUTED: 'UNATTRIBUTED',
} as const;

export const CONTACT_EMAIL_VERIFICATION_STATUS = {
  UNVERIFIED: 'UNVERIFIED',
  /** Reserved — never set without a real SMTP/API verification result. */
  VERIFIED: 'VERIFIED',
} as const;

export type ContactEmailDiscoveryStatus =
  (typeof CONTACT_EMAIL_DISCOVERY_STATUS)[keyof typeof CONTACT_EMAIL_DISCOVERY_STATUS];

export type ContactEmailAttributionStatus =
  (typeof CONTACT_EMAIL_ATTRIBUTION_STATUS)[keyof typeof CONTACT_EMAIL_ATTRIBUTION_STATUS];

export type ContactEmailVerificationStatus =
  (typeof CONTACT_EMAIL_VERIFICATION_STATUS)[keyof typeof CONTACT_EMAIL_VERIFICATION_STATUS];

export type PersonEmailSourceKind = 'linkedin' | 'brand_web' | 'ocr';

function firstNameToken(name: string): string | null {
  const token = name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (token.length < 2) return null;
  return token;
}

/**
 * RF-01 / RF-01.1: associate an email to a person only with explicit evidence.
 *
 * - Shared corporate inboxes (info@, partnerships@, …) are NEVER person-attributed,
 *   including when sourceKind is linkedin (dataset fields or about text).
 * - linkedin + non-generic: profile-published personal address may attribute.
 * - brand_web/ocr: evidence snippet must mention person name token AND the email.
 */
export function canAttributeEmailToPerson(params: {
  email: string;
  personName: string;
  sourceKind: PersonEmailSourceKind;
  evidenceSnippet?: string | null;
}): boolean {
  const email = params.email.trim().toLowerCase();
  if (!email.includes('@')) {
    return false;
  }

  // RF-01.1: reject shared inboxes for every sourceKind (including linkedin).
  if (classifyPublicEmailGeneric(email)) {
    return false;
  }

  if (params.sourceKind === 'linkedin') {
    return true;
  }

  const token = firstNameToken(params.personName);
  if (!token) {
    return false;
  }
  const snippet = (params.evidenceSnippet ?? '').toLowerCase();
  if (!snippet.includes(email)) {
    return false;
  }
  // Name must appear outside the email local-part (avoid "alex" matching alex@…).
  const withoutEmail = snippet.split(email).join(' ');
  const nameWord = new RegExp(
    `(^|[^a-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`,
  );
  return nameWord.test(withoutEmail);
}
