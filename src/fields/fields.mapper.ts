/**
 * Saleshandy prospect fields ↔ local `CustomField` (HU-FLD-001..005).
 *
 * Verified against the live API (2026-11-25): GET /v1/fields returns
 * `{ id, label, fieldType, tags, mappingDefaultField? }` and ignores the
 * `systemFields` flag. System fields carry the `mappingDefaultField` key (even
 * when empty); custom fields do not. `fallbackText` / `metadata` are never
 * returned, so they only live locally.
 */
import type {
  CustomField,
  CustomFieldDisabledReason,
  CustomFieldOrigin,
  CustomFieldType,
} from '../generated/prisma/client';

/** Saleshandy wire values (also used in our REST contract). */
export const FIELD_TYPES = [
  'text',
  'number',
  'date',
  'long-text',
  'dropdown',
  'currency',
] as const;
export type FieldTypeValue = (typeof FIELD_TYPES)[number];

const TO_LOCAL: Record<FieldTypeValue, CustomFieldType> = {
  text: 'TEXT',
  number: 'NUMBER',
  date: 'DATE',
  'long-text': 'LONG_TEXT',
  dropdown: 'DROPDOWN',
  currency: 'CURRENCY',
};

const TO_REMOTE = Object.fromEntries(
  Object.entries(TO_LOCAL).map(([remote, local]) => [local, remote]),
) as Record<CustomFieldType, FieldTypeValue>;

/** ISO 4217 codes accepted by Saleshandy for currency fields. */
export const CURRENCY_CODES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'CNY',
  'INR',
  'SGD',
  'HKD',
  'NZD',
  'KRW',
  'SEK',
  'AED',
  'BRL',
  'MXN',
  'ZAR',
  'SAR',
] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export const MAX_DROPDOWN_OPTIONS = 50;
export const MAX_FIELD_TAGS = 20;

export function isFieldType(value: unknown): value is FieldTypeValue {
  return (
    typeof value === 'string' &&
    (FIELD_TYPES as readonly string[]).includes(value)
  );
}

export function toLocalFieldType(value: FieldTypeValue): CustomFieldType {
  return TO_LOCAL[value];
}

export function toRemoteFieldType(value: CustomFieldType): FieldTypeValue {
  return TO_REMOTE[value];
}

export type FieldMetadata = { options?: string[]; currencyCode?: CurrencyCode };

/** Trims, drops empties and de-duplicates case-insensitively (first spelling wins). */
export function normalizeList(
  values: readonly unknown[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim().replace(/\s+/g, ' ');
    const lower = trimmed.toLowerCase();
    if (!trimmed || seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  return out;
}

/**
 * Validates per-type metadata (FLD-003 CA-04). Returns the metadata to send
 * and store (`null` for types that do not use it) or an error message.
 */
export function buildFieldMetadata(
  fieldType: FieldTypeValue,
  metadata: { options?: unknown[]; currencyCode?: unknown } | undefined,
): { metadata: FieldMetadata | null } | { error: string } {
  if (fieldType === 'dropdown') {
    const options = normalizeList(metadata?.options);
    if (options.length === 0)
      return { error: 'Dropdown fields need at least one option.' };
    if (options.length > MAX_DROPDOWN_OPTIONS) {
      return {
        error: `Dropdown fields accept up to ${MAX_DROPDOWN_OPTIONS} options.`,
      };
    }
    return { metadata: { options } };
  }
  if (fieldType === 'currency') {
    const code =
      typeof metadata?.currencyCode === 'string'
        ? metadata.currencyCode.toUpperCase()
        : '';
    if (!(CURRENCY_CODES as readonly string[]).includes(code)) {
      return { error: 'Currency fields need a supported currency code.' };
    }
    return { metadata: { currencyCode: code as CurrencyCode } };
  }
  return { metadata: null };
}

/** `Deal Stage` → `dealStage`; accents removed; never empty. */
export function slugifyKey(label: string): string {
  const words = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const key = words
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('')
    .slice(0, 60);
  return /^[a-z]/.test(key)
    ? key
    : `field${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/** Returns `base`, or `base2`, `base3`… when taken. Registers the result in `taken`. */
export function uniqueKey(base: string, taken: Set<string>): string {
  let key = base;
  for (let n = 2; taken.has(key.toLowerCase()); n++) key = `${base}${n}`;
  taken.add(key.toLowerCase());
  return key;
}

export type RemoteField = {
  id: string;
  label: string;
  fieldType: FieldTypeValue;
  origin: CustomFieldOrigin;
  systemMapping: string | null;
  tags: string[];
};

export type ParsedRemoteFields =
  | { ok: true; fields: RemoteField[]; skippedIds: string[] }
  | { ok: false; reason: string };

/**
 * Strict parse of GET /v1/fields (FLD-005 CA-04): any malformed entry rejects
 * the whole response so a partial payload never overwrites local data. Entries
 * with an unknown (future) `fieldType` are skipped but reported, so they are
 * not mistaken for deletions.
 */
export function parseRemoteFields(payload: unknown): ParsedRemoteFields {
  if (!Array.isArray(payload))
    return { ok: false, reason: 'payload_not_array' };
  const fields: RemoteField[] = [];
  const skippedIds: string[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of payload.entries()) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, reason: `invalid_entry_${index}` };
    }
    const raw = entry as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    if (!id || !label) return { ok: false, reason: `invalid_entry_${index}` };
    if (ids.has(id)) return { ok: false, reason: `duplicate_id_${id}` };
    ids.add(id);
    if (!isFieldType(raw.fieldType)) {
      skippedIds.push(id);
      continue;
    }
    const tags = Array.isArray(raw.tags)
      ? normalizeList(
          (raw.tags as unknown[]).map((t): unknown =>
            t && typeof t === 'object'
              ? (t as Record<string, unknown>).name
              : t,
          ),
        )
      : [];
    const hasMapping = 'mappingDefaultField' in raw;
    const mapping =
      typeof raw.mappingDefaultField === 'string' &&
      raw.mappingDefaultField.trim()
        ? raw.mappingDefaultField.trim()
        : null;
    fields.push({
      id,
      label,
      fieldType: raw.fieldType,
      origin: hasMapping || raw.isDefault === true ? 'SYSTEM' : 'CUSTOM',
      systemMapping: mapping,
      tags,
    });
  }
  return { ok: true, fields, skippedIds };
}

export type CustomFieldDto = {
  id: string;
  key: string;
  label: string;
  fieldType: FieldTypeValue;
  origin: CustomFieldOrigin;
  fallbackText: string | null;
  metadata: FieldMetadata | null;
  tags: string[];
  isActive: boolean;
  disabledReason: CustomFieldDisabledReason | null;
  /** CUSTOM, linked to Saleshandy and still present there. */
  editable: boolean;
  saleshandyFieldId: string | null;
  systemMapping: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isEditable(
  field: Pick<CustomField, 'origin' | 'saleshandyFieldId' | 'disabledReason'>,
) {
  return (
    field.origin === 'CUSTOM' &&
    !!field.saleshandyFieldId &&
    field.disabledReason !== 'REMOVED_IN_SALESHANDY'
  );
}

export function toFieldDto(field: CustomField): CustomFieldDto {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    fieldType: toRemoteFieldType(field.fieldType),
    origin: field.origin,
    fallbackText: field.fallbackText,
    metadata: (field.metadata as FieldMetadata | null) ?? null,
    tags: field.tags,
    isActive: field.isActive,
    disabledReason: field.disabledReason,
    editable: isEditable(field),
    saleshandyFieldId: field.saleshandyFieldId,
    systemMapping: field.systemMapping,
    lastSyncedAt: field.lastSyncedAt?.toISOString() ?? null,
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString(),
  };
}
