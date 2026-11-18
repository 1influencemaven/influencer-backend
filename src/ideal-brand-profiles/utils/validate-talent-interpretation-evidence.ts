import type {
  EvidenceRef,
  InstagramResearchEvidenceContract,
  TalentInterpretationOutput,
} from '@influence-maven/ai-contracts';

const META_PATHS = new Set([
  'version',
  'source',
  'fetchedAt',
  'handleNormalized',
  'profileUrl',
]);

const NORMALIZED_SCALAR_PATHS = new Set([
  'normalized.account',
  'normalized.displayName',
  'normalized.biography',
  'normalized.followers',
  'normalized.following',
  'normalized.postsCount',
  'normalized.isPrivate',
  'normalized.isVerified',
  'normalized.emailAddress',
  'normalized.profileImageUrl',
  'normalized.profileUrl',
]);

const ARRAY_PATH_RE =
  /^normalized\.(externalUrls|bioHashtags|postHashtags)\[(\d+)\]$/;

export type TalentInterpretationValidationResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Deterministic Nest checks: fieldPath allowlist + value equality vs snapshot.
 * Does not invent values. When evidence is null, only insufficientEvidence=true
 * with empty collections is accepted.
 */
export function validateTalentInterpretationAgainstEvidence(params: {
  interpretation: TalentInterpretationOutput;
  evidence: InstagramResearchEvidenceContract | null;
}): TalentInterpretationValidationResult {
  const { interpretation, evidence } = params;

  if (!evidence) {
    if (!interpretation.insufficientEvidence) {
      return {
        ok: false,
        message:
          'talentInterpretation.insufficientEvidence must be true when Instagram research evidence is unavailable',
      };
    }
    if (
      interpretation.summary !== null ||
      interpretation.niches.length > 0 ||
      interpretation.contentCategories.length > 0 ||
      interpretation.commercialSignals.length > 0
    ) {
      return {
        ok: false,
        message:
          'talentInterpretation must not include classifications without Instagram research evidence',
      };
    }
    if (interpretation.limitations.length === 0) {
      return {
        ok: false,
        message: 'talentInterpretation.limitations required when evidence is unavailable',
      };
    }
    return { ok: true };
  }

  const refs = collectEvidenceRefs(interpretation);
  for (const ref of refs) {
    const check = assertEvidenceRef(evidence, ref);
    if (!check.ok) {
      return check;
    }
  }

  return { ok: true };
}

function collectEvidenceRefs(
  interpretation: TalentInterpretationOutput,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  if (interpretation.summary) {
    refs.push(...interpretation.summary.evidence);
  }
  for (const item of interpretation.niches) {
    refs.push(...item.evidence);
  }
  for (const item of interpretation.contentCategories) {
    refs.push(...item.evidence);
  }
  for (const item of interpretation.commercialSignals) {
    refs.push(...item.evidence);
  }
  return refs;
}

function assertEvidenceRef(
  evidence: InstagramResearchEvidenceContract,
  ref: EvidenceRef,
): TalentInterpretationValidationResult {
  if (META_PATHS.has(ref.fieldPath)) {
    const actual = (evidence as Record<string, unknown>)[ref.fieldPath];
    if (!valuesEqual(actual, ref.value)) {
      return {
        ok: false,
        message: `evidence value mismatch for ${ref.fieldPath}`,
      };
    }
    return { ok: true };
  }

  if (NORMALIZED_SCALAR_PATHS.has(ref.fieldPath)) {
    const key = ref.fieldPath.replace(
      'normalized.',
      '',
    ) as keyof InstagramResearchEvidenceContract['normalized'];
    const actual = evidence.normalized[key];
    if (!valuesEqual(actual, ref.value)) {
      return {
        ok: false,
        message: `evidence value mismatch for ${ref.fieldPath}`,
      };
    }
    return { ok: true };
  }

  const arrayMatch = ARRAY_PATH_RE.exec(ref.fieldPath);
  if (arrayMatch) {
    const arrayKey = arrayMatch[1] as
      | 'externalUrls'
      | 'bioHashtags'
      | 'postHashtags';
    const index = Number(arrayMatch[2]);
    const arr = evidence.normalized[arrayKey];
    if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
      return {
        ok: false,
        message: `evidence path out of range: ${ref.fieldPath}`,
      };
    }
    if (!valuesEqual(arr[index], ref.value)) {
      return {
        ok: false,
        message: `evidence value mismatch for ${ref.fieldPath}`,
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    message: `evidence fieldPath not allowlisted: ${ref.fieldPath}`,
  };
}

function normalizeComparableString(value: string): string {
  return value.trim().replace(/^#+/u, '').toLocaleLowerCase();
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) {
    return true;
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return (
      normalizeComparableString(actual) === normalizeComparableString(expected)
    );
  }
  if (typeof actual === 'number' && typeof expected === 'string') {
    const asNumber = Number(expected.trim());
    return Number.isFinite(asNumber) && actual === asNumber;
  }
  if (typeof expected === 'number' && typeof actual === 'string') {
    const asNumber = Number(actual.trim());
    return Number.isFinite(asNumber) && expected === asNumber;
  }
  return false;
}
