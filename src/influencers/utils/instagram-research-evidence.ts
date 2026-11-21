/**
 * Snapshot of Instagram username research retained on Influencer create
 * for later Mastra interpretation (phase 2). Does not invent niches.
 */

export const INSTAGRAM_RESEARCH_EVIDENCE_VERSION = 1 as const;

export type InstagramResearchEvidenceNormalized = {
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

export type InstagramResearchEvidence = {
  version: typeof INSTAGRAM_RESEARCH_EVIDENCE_VERSION;
  source: string;
  fetchedAt: string;
  handleNormalized: string;
  profileUrl: string;
  normalized: InstagramResearchEvidenceNormalized;
};

export type InstagramResearchEvidenceInput = {
  source?: string;
  fetchedAt?: string;
  handleNormalized?: string;
  profileUrl?: string;
  normalized?: Partial<InstagramResearchEvidenceNormalized> | null;
};

/**
 * Validates and normalizes create-body research evidence.
 * Returns null when the payload is unusable (missing required meta).
 */
export function sanitizeInstagramResearchEvidence(
  input: InstagramResearchEvidenceInput | null | undefined,
): InstagramResearchEvidence | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const source = asNonEmptyString(input.source);
  const fetchedAt = asIsoDateString(input.fetchedAt);
  const handleNormalized = asNonEmptyString(input.handleNormalized)
    ?.replace(/^@/, '')
    .toLowerCase();
  const profileUrl = asNonEmptyString(input.profileUrl);
  const rawNormalized = (input.normalized ?? {}) as Partial<
    InstagramResearchEvidenceNormalized
  > &
    Record<string, unknown>;

  if (!source || !fetchedAt || !handleNormalized || !profileUrl) {
    return null;
  }
  if (!rawNormalized || typeof rawNormalized !== 'object') {
    return null;
  }

  const email = asNonEmptyString(rawNormalized.emailAddress);
  const normalized: InstagramResearchEvidenceNormalized = {
    account: normalizeAccount(asNonEmptyString(rawNormalized.account)),
    displayName: asNonEmptyString(rawNormalized.displayName) ?? null,
    biography: asNonEmptyString(rawNormalized.biography) ?? null,
    followers: asNonNegativeInt(rawNormalized.followers),
    following: asNonNegativeInt(rawNormalized.following),
    postsCount: asNonNegativeInt(rawNormalized.postsCount),
    isPrivate: asBooleanOrNull(rawNormalized.isPrivate),
    isVerified: asBooleanOrNull(rawNormalized.isVerified),
    emailAddress: email && email.includes('@') ? email.toLowerCase() : null,
    profileImageUrl: asNonEmptyString(rawNormalized.profileImageUrl) ?? null,
    profileUrl: asNonEmptyString(rawNormalized.profileUrl) ?? null,
    externalUrls: asStringArray(rawNormalized.externalUrls),
    bioHashtags: asStringArray(rawNormalized.bioHashtags),
    postHashtags: asStringArray(rawNormalized.postHashtags),
  };

  return {
    version: INSTAGRAM_RESEARCH_EVIDENCE_VERSION,
    source,
    fetchedAt,
    handleNormalized,
    profileUrl,
    normalized,
  };
}

export function resolveScalarFromResearch(params: {
  dtoValue: number | string | undefined;
  researchValue: number | string | null;
}): number | string | undefined {
  if (params.dtoValue !== undefined) {
    return params.dtoValue;
  }
  if (params.researchValue === null || params.researchValue === undefined) {
    return undefined;
  }
  return params.researchValue;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asIsoDateString(value: unknown): string | undefined {
  const raw = asNonEmptyString(value);
  if (!raw) {
    return undefined;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 0) {
      return Math.trunc(n);
    }
  }
  return null;
}

function asBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string' && !!item.trim())
    .map((item) => item.trim());
}

function normalizeAccount(account: string | undefined): string | null {
  if (!account) {
    return null;
  }
  const normalized = account.replace(/^@/, '').trim().toLowerCase();
  return normalized || null;
}
