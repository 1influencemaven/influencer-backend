/**
 * Builds a read-only Instagram username research payload from a Bright Data
 * Instagram Profiles row. Does not invent values; only copies present fields.
 */

export type InstagramUsernameLookupOutcome =
  | 'FOUND'
  | 'PROFILE_PRIVATE'
  | 'PROFILE_NOT_FOUND'
  | 'INCOMPLETE_RESPONSE';

/** Provider keys observed on Instagram Profiles (`gd_l1vikfch901nx3by4`). */
export const INSTAGRAM_PROFILE_PROVIDER_KEYS = [
  'account',
  'fbid',
  'id',
  'followers',
  'posts_count',
  'is_verified',
  'external_url',
  'biography',
  'post_hashtags',
  'following',
  'posts',
  'profile_image_link',
  'profile_url',
  'profile_name',
  'highlights_count',
  'highlights',
  'full_name',
  'is_private',
  'bio_hashtags',
  'url',
  'is_joined_recently',
  'partner_id',
  'email_address',
  'external_url_title',
  'pronouns',
  'external_urls',
  'timestamp',
  'input',
  'warning',
  'warning_code',
  'error',
] as const;

export type InstagramUsernameLookupNormalized = {
  account: string | null;
  displayName: string | null;
  biography: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  isPrivate: boolean | null;
  isVerified: boolean | null;
  emailAddress: string | null;
  profileImageUrl: string | null;
  profileUrl: string | null;
  externalUrls: string[];
  bioHashtags: string[];
  postHashtags: string[];
};

export type InstagramUsernameLookupResult = {
  outcome: InstagramUsernameLookupOutcome;
  handleNormalized: string;
  profileUrl: string;
  normalized: InstagramUsernameLookupNormalized;
  /** Subset of the Bright Data row: only keys that were present. */
  provider: Record<string, unknown>;
};

export function buildInstagramUsernameLookup(params: {
  row: Record<string, unknown>;
  handleNormalized: string;
  requestedProfileUrl: string;
}): InstagramUsernameLookupResult {
  const provider = pickPresentProviderFields(params.row);
  const normalized = normalizeFromRow(params.row);
  const profileUrl =
    normalized.profileUrl ?? params.requestedProfileUrl;

  if (isNotFoundRow(params.row)) {
    return {
      outcome: 'PROFILE_NOT_FOUND',
      handleNormalized: params.handleNormalized,
      profileUrl,
      normalized,
      provider,
    };
  }

  if (normalized.isPrivate === true) {
    return {
      outcome: 'PROFILE_PRIVATE',
      handleNormalized:
        normalized.account ?? params.handleNormalized,
      profileUrl,
      normalized,
      provider,
    };
  }

  if (!hasUsableProfileSignal(normalized, provider)) {
    return {
      outcome: 'INCOMPLETE_RESPONSE',
      handleNormalized:
        normalized.account ?? params.handleNormalized,
      profileUrl,
      normalized,
      provider,
    };
  }

  return {
    outcome: 'FOUND',
    handleNormalized: normalized.account ?? params.handleNormalized,
    profileUrl,
    normalized,
    provider,
  };
}

function normalizeFromRow(
  row: Record<string, unknown>,
): InstagramUsernameLookupNormalized {
  const email = stringField(row, 'email_address');
  return {
    account: normalizeAccount(stringField(row, 'account')),
    displayName:
      stringField(row, 'profile_name') ||
      stringField(row, 'full_name') ||
      null,
    biography: stringField(row, 'biography') ?? null,
    followers: numberField(row, 'followers') ?? null,
    following: numberField(row, 'following') ?? null,
    postsCount: numberField(row, 'posts_count') ?? null,
    isPrivate: booleanField(row, 'is_private'),
    isVerified: booleanField(row, 'is_verified'),
    emailAddress:
      email && email.includes('@') ? email.toLowerCase() : null,
    profileImageUrl: stringField(row, 'profile_image_link') ?? null,
    profileUrl:
      stringField(row, 'profile_url') || stringField(row, 'url') || null,
    externalUrls: stringArrayField(row, 'external_urls').length
      ? stringArrayField(row, 'external_urls')
      : stringArrayField(row, 'external_url'),
    bioHashtags: stringArrayField(row, 'bio_hashtags'),
    postHashtags: stringArrayField(row, 'post_hashtags'),
  };
}

function hasUsableProfileSignal(
  normalized: InstagramUsernameLookupNormalized,
  _provider: Record<string, unknown>,
): boolean {
  return Boolean(
    normalized.account ||
      normalized.displayName ||
      normalized.biography ||
      normalized.followers !== null ||
      normalized.following !== null ||
      normalized.postsCount !== null ||
      normalized.emailAddress ||
      normalized.profileImageUrl ||
      normalized.bioHashtags.length > 0 ||
      normalized.postHashtags.length > 0 ||
      normalized.externalUrls.length > 0,
  );
}

function pickPresentProviderFields(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of INSTAGRAM_PROFILE_PROVIDER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      out[key] = row[key];
    }
  }
  return out;
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

  const hasIdentity =
    Boolean(stringField(row, 'account')) ||
    Boolean(stringField(row, 'profile_name')) ||
    Boolean(stringField(row, 'full_name')) ||
    Boolean(stringField(row, 'id'));
  const hasMetrics = numberField(row, 'followers') !== undefined;

  return !hasIdentity && !hasMetrics;
}

function normalizeAccount(account: string | null | undefined): string | null {
  if (!account) {
    return null;
  }
  const normalized = account.replace(/^@/, '').trim().toLowerCase();
  return normalized || null;
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

function booleanField(
  row: Record<string, unknown>,
  key: string,
): boolean | null {
  const v = row[key];
  if (typeof v === 'boolean') {
    return v;
  }
  if (v === 1 || v === 0) {
    return v === 1;
  }
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }
  return null;
}

function stringArrayField(
  row: Record<string, unknown>,
  key: string,
): string[] {
  const v = row[key];
  if (Array.isArray(v)) {
    return v
      .filter((item): item is string => typeof item === 'string' && !!item.trim())
      .map((item) => item.trim());
  }
  if (typeof v === 'string' && v.trim()) {
    return [v.trim()];
  }
  return [];
}
