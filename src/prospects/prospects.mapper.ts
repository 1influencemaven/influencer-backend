/**
 * Prospect helpers: email normalization, RF-01-safe names, column mapping for
 * Saleshandy system fields and the duplicate merge policy (same semantics as
 * Saleshandy's `conflictAction`).
 */
import type {
  CommercialRelevance,
  Prospect,
  ProspectContactKind,
  ProspectSource,
  ProspectStatus,
  ProspectSyncStatus,
} from '../generated/prisma/client';

export const CONFLICT_ACTIONS = [
  'addMissingFields',
  'overwrite',
  'noUpdate',
] as const;
export type ConflictAction = (typeof CONFLICT_ACTIONS)[number];

const EMAIL_RE =
  /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const value = email.trim();
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** `Ana María Pérez` → { firstName: 'Ana', lastName: 'María Pérez' }. Never guesses from the email. */
export function splitName(fullName: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || null };
}

/**
 * Saleshandy system field key (CustomField.key / systemMapping) → Prospect
 * column. Everything else is stored in ProspectFieldValue.
 */
export const SYSTEM_FIELD_COLUMNS = {
  email: 'email',
  firstName: 'firstName',
  lastName: 'lastName',
  jobTitle: 'jobTitle',
  company: 'company',
  companyDomain: 'companyDomain',
  website: 'website',
  linkedIn: 'linkedInUrl',
  country: 'country',
  phoneNumber: 'phoneNumber',
} as const;
export type ProspectColumn =
  (typeof SYSTEM_FIELD_COLUMNS)[keyof typeof SYSTEM_FIELD_COLUMNS];
export type ProspectColumnKey = keyof typeof SYSTEM_FIELD_COLUMNS;

export function columnForFieldKey(key: string): ProspectColumn | null {
  return (SYSTEM_FIELD_COLUMNS as Record<string, ProspectColumn>)[key] ?? null;
}

/** Mutable prospect attributes that ingestion/import can set. */
export type ProspectAttributes = Partial<
  Record<Exclude<ProspectColumn, 'email'>, string | null>
> & {
  contactKind?: ProspectContactKind;
  isGeneric?: boolean;
  mailboxLabel?: string | null;
  commercialRelevance?: CommercialRelevance;
};

const MERGEABLE: Array<keyof ProspectAttributes> = [
  'firstName',
  'lastName',
  'jobTitle',
  'company',
  'companyDomain',
  'website',
  'linkedInUrl',
  'country',
  'phoneNumber',
  'mailboxLabel',
];

const isBlank = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && !v.trim());

/**
 * Data to write on an existing prospect. `addMissingFields` fills blanks only,
 * `overwrite` replaces with every non-empty incoming value (blanks never erase
 * data), `noUpdate` changes nothing.
 */
export function mergeAttributes(
  existing: Partial<Record<keyof ProspectAttributes, unknown>>,
  incoming: ProspectAttributes,
  action: ConflictAction,
): ProspectAttributes {
  if (action === 'noUpdate') return {};
  const data: ProspectAttributes = {};
  for (const key of MERGEABLE) {
    const value = incoming[key];
    if (isBlank(value)) continue;
    if (action === 'overwrite' || isBlank(existing[key])) {
      (data as Record<string, unknown>)[key] = value;
    }
  }
  // A real person always wins over a generic mailbox classification.
  if (incoming.contactKind === 'PERSON' && existing.contactKind === 'MAILBOX') {
    data.contactKind = 'PERSON';
    data.isGeneric = false;
  }
  if (
    incoming.commercialRelevance &&
    incoming.commercialRelevance !== 'UNKNOWN' &&
    (action === 'overwrite' || existing.commercialRelevance === 'UNKNOWN')
  ) {
    data.commercialRelevance = incoming.commercialRelevance;
  }
  return data;
}

export function mergeTags(
  current: string[],
  incoming: string[] = [],
): string[] {
  const seen = new Set(current.map((t) => t.toLowerCase()));
  const out = [...current];
  for (const tag of incoming) {
    const clean = tag.trim();
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      out.push(clean);
    }
  }
  return out;
}

export function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const host = new URL(value.includes('://') ? value : `https://${value}`)
      .hostname;
    return host.replace(/^www\./i, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

export type ProspectDto = {
  id: string;
  influencerId: string;
  influencerName: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  website: string | null;
  linkedInUrl: string | null;
  country: string | null;
  phoneNumber: string | null;
  contactKind: ProspectContactKind;
  isGeneric: boolean;
  mailboxLabel: string | null;
  commercialRelevance: CommercialRelevance;
  source: ProspectSource;
  brandCandidateId: string | null;
  brandName: string | null;
  leadId: string | null;
  brandBusinessContactId: string | null;
  agencyId: string | null;
  agencyName: string | null;
  agencyContactId: string | null;
  tags: string[];
  status: ProspectStatus;
  syncStatus: ProspectSyncStatus;
  customFields: Array<{
    fieldId: string;
    key: string;
    label: string;
    value: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type ProspectWithRelations = Prospect & {
  influencer?: { name: string } | null;
  brandCandidate?: { name: string } | null;
  agency?: { name: string } | null;
  fieldValues?: Array<{
    value: string;
    customField: { id: string; key: string; label: string };
  }>;
};

export function toProspectDto(p: ProspectWithRelations): ProspectDto {
  return {
    id: p.id,
    influencerId: p.influencerId,
    influencerName: p.influencer?.name ?? null,
    email: p.email,
    firstName: p.firstName,
    lastName: p.lastName,
    jobTitle: p.jobTitle,
    company: p.company,
    companyDomain: p.companyDomain,
    website: p.website,
    linkedInUrl: p.linkedInUrl,
    country: p.country,
    phoneNumber: p.phoneNumber,
    contactKind: p.contactKind,
    isGeneric: p.isGeneric,
    mailboxLabel: p.mailboxLabel,
    commercialRelevance: p.commercialRelevance,
    source: p.source,
    brandCandidateId: p.brandCandidateId,
    brandName: p.brandCandidate?.name ?? null,
    leadId: p.leadId,
    brandBusinessContactId: p.brandBusinessContactId,
    agencyId: p.agencyId,
    agencyName: p.agency?.name ?? null,
    agencyContactId: p.agencyContactId,
    tags: p.tags,
    status: p.status,
    syncStatus: p.syncStatus,
    customFields: (p.fieldValues ?? []).map((v) => ({
      fieldId: v.customField.id,
      key: v.customField.key,
      label: v.customField.label,
      value: v.value,
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
