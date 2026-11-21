import {
  INFLUENCER_FIELD_KEYS,
  type InfluencerFieldKey,
} from './influencer-field-keys';
import type { ExternalFieldCandidate } from './influencer-provenance';

/** Soft/hard outcomes for Instagram research (HU-TM-003). */
export type InstagramProfileRowOutcome =
  | 'ok'
  | 'private'
  | 'not_found'
  | 'incomplete';

export type MappedInstagramProfile = {
  outcome: InstagramProfileRowOutcome;
  /** Profile URL used / returned by provider. */
  profileUrl?: string;
  /** Normalized account handle from provider when present. */
  accountNormalized?: string;
  candidates: ExternalFieldCandidate<unknown>[];
};

/**
 * Maps Bright Data Instagram Profiles (`gd_l1vikfch901nx3by4`) row fields
 * onto Influencer field keys. Only maps provider fields that exist on Influencer.
 * Does not invent engagement (not in dataset output).
 */
export function mapInstagramProfileRow(
  row: Record<string, unknown>,
): MappedInstagramProfile {
  if (isNotFoundRow(row)) {
    return { outcome: 'not_found', candidates: [] };
  }

  if (isTruthy(row.is_private)) {
    return {
      outcome: 'private',
      profileUrl: stringField(row, 'profile_url') || stringField(row, 'url'),
      accountNormalized: normalizeAccount(stringField(row, 'account')),
      candidates: [],
    };
  }

  const candidates: ExternalFieldCandidate<unknown>[] = [];

  const displayName =
    stringField(row, 'profile_name') || stringField(row, 'full_name');
  if (displayName) {
    candidates.push({
      fieldKey: INFLUENCER_FIELD_KEYS.NAME,
      value: displayName,
    });
  }

  const followers = numberField(row, 'followers');
  if (followers !== undefined) {
    candidates.push({
      fieldKey: INFLUENCER_FIELD_KEYS.FOLLOWERS,
      value: followers,
    });
  }

  const email = stringField(row, 'email_address');
  if (email && email.includes('@')) {
    candidates.push({
      fieldKey: INFLUENCER_FIELD_KEYS.EMAIL,
      value: email.toLowerCase(),
    });
  }

  const accountNormalized = normalizeAccount(stringField(row, 'account'));
  const profileUrl =
    stringField(row, 'profile_url') || stringField(row, 'url');

  if (candidates.length === 0) {
    return {
      outcome: 'incomplete',
      profileUrl,
      accountNormalized,
      candidates: [],
    };
  }

  return {
    outcome: 'ok',
    profileUrl,
    accountNormalized,
    candidates,
  };
}

export function skippedManualKeys(
  candidates: ExternalFieldCandidate<unknown>[],
  origins: Map<string, string>,
): InfluencerFieldKey[] {
  return candidates
    .filter((c) => origins.get(c.fieldKey) === 'MANUAL')
    .map((c) => c.fieldKey);
}

function isNotFoundRow(row: Record<string, unknown>): boolean {
  const warning = stringField(row, 'warning')?.toLowerCase() ?? '';
  const warningCode = stringField(row, 'warning_code')?.toLowerCase() ?? '';
  const error = stringField(row, 'error')?.toLowerCase() ?? '';

  if (
    warningCode.includes('not_found') ||
    warningCode.includes('dead_page') ||
    warning.includes('not found') ||
    warning.includes('does not exist') ||
    error.includes('not found')
  ) {
    return true;
  }

  // Empty shell with neither identity nor metrics
  const hasIdentity =
    Boolean(stringField(row, 'account')) ||
    Boolean(stringField(row, 'profile_name')) ||
    Boolean(stringField(row, 'full_name')) ||
    Boolean(stringField(row, 'id'));
  const hasMetrics = numberField(row, 'followers') !== undefined;

  return !hasIdentity && !hasMetrics;
}

function normalizeAccount(account: string | undefined): string | undefined {
  if (!account) {
    return undefined;
  }
  return account.replace(/^@/, '').trim().toLowerCase() || undefined;
}

function stringField(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = row[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function numberField(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = row[key];
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    return Math.trunc(v);
  }
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 0) {
      return Math.trunc(n);
    }
  }
  return undefined;
}

function isTruthy(value: unknown): boolean {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}
