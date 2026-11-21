import type {
  EvidenceRef,
  InstagramResearchEvidenceContract,
  TalentInterpretationOutput,
} from '@influence-maven/ai-contracts';

const SCALAR_ALIASES: Record<string, string> = {
  account: 'normalized.account',
  displayName: 'normalized.displayName',
  biography: 'normalized.biography',
  followers: 'normalized.followers',
  following: 'normalized.following',
  postsCount: 'normalized.postsCount',
  isPrivate: 'normalized.isPrivate',
  isVerified: 'normalized.isVerified',
  emailAddress: 'normalized.emailAddress',
  profileImageUrl: 'normalized.profileImageUrl',
  profileUrl: 'normalized.profileUrl',
  'normalized.account': 'normalized.account',
  'normalized.displayName': 'normalized.displayName',
  'normalized.biography': 'normalized.biography',
  'normalized.followers': 'normalized.followers',
  'normalized.following': 'normalized.following',
  'normalized.postsCount': 'normalized.postsCount',
  'normalized.isPrivate': 'normalized.isPrivate',
  'normalized.isVerified': 'normalized.isVerified',
  'normalized.emailAddress': 'normalized.emailAddress',
  'normalized.profileImageUrl': 'normalized.profileImageUrl',
  'normalized.profileUrl': 'normalized.profileUrl',
};

const ARRAY_ALIASES: Record<
  string,
  'postHashtags' | 'bioHashtags' | 'externalUrls'
> = {
  postHashtags: 'postHashtags',
  bioHashtags: 'bioHashtags',
  externalUrls: 'externalUrls',
  'normalized.postHashtags': 'postHashtags',
  'normalized.bioHashtags': 'bioHashtags',
  'normalized.externalUrls': 'externalUrls',
};

const INDEXED_ARRAY_RE =
  /^(?:normalized\.)?(externalUrls|bioHashtags|postHashtags)\[(\d+)\]$/;

const META_PATHS = new Set([
  'version',
  'source',
  'fetchedAt',
  'handleNormalized',
  'profileUrl',
]);

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

function valueTokens(value: EvidenceRef['value']): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(/[,|/]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function findInStringArray(
  arr: string[],
  candidates: Array<string | number | boolean | null>,
): { index: number; value: string } | null {
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate === 'boolean') {
      continue;
    }
    const asString =
      typeof candidate === 'number' ? String(candidate) : candidate;
    const index = arr.findIndex((item) => valuesEqual(item, asString));
    if (index >= 0) {
      return { index, value: arr[index]! };
    }
  }
  return null;
}

function resolveArrayRef(
  evidence: InstagramResearchEvidenceContract,
  arrayKey: 'postHashtags' | 'bioHashtags' | 'externalUrls',
  value: EvidenceRef['value'],
  preferredIndex?: number,
): EvidenceRef | null {
  const arr = evidence.normalized[arrayKey];
  if (!Array.isArray(arr) || arr.length === 0) {
    return null;
  }

  if (
    preferredIndex !== undefined &&
    preferredIndex >= 0 &&
    preferredIndex < arr.length &&
    valuesEqual(arr[preferredIndex], value)
  ) {
    return {
      fieldPath: `normalized.${arrayKey}[${preferredIndex}]`,
      value: arr[preferredIndex] as string | number | boolean | null,
    };
  }

  const candidates: Array<string | number | boolean | null> = [
    value,
    ...valueTokens(value),
  ];
  const hit = findInStringArray(arr, candidates);
  if (!hit) {
    return null;
  }
  return {
    fieldPath: `normalized.${arrayKey}[${hit.index}]`,
    value: hit.value,
  };
}

function searchAllArrays(
  evidence: InstagramResearchEvidenceContract,
  value: EvidenceRef['value'],
): EvidenceRef | null {
  for (const arrayKey of [
    'postHashtags',
    'bioHashtags',
    'externalUrls',
  ] as const) {
    const resolved = resolveArrayRef(evidence, arrayKey, value);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function isAllowlistedResolvedRef(
  evidence: InstagramResearchEvidenceContract,
  ref: EvidenceRef,
): boolean {
  if (META_PATHS.has(ref.fieldPath)) {
    const actual = (evidence as Record<string, unknown>)[ref.fieldPath];
    return valuesEqual(actual, ref.value);
  }

  if (ref.fieldPath.startsWith('normalized.')) {
    const indexed = INDEXED_ARRAY_RE.exec(ref.fieldPath);
    if (indexed) {
      const arrayKey = indexed[1] as
        | 'postHashtags'
        | 'bioHashtags'
        | 'externalUrls';
      const index = Number(indexed[2]);
      const arr = evidence.normalized[arrayKey];
      return (
        Array.isArray(arr) &&
        index >= 0 &&
        index < arr.length &&
        valuesEqual(arr[index], ref.value)
      );
    }

    const key = ref.fieldPath.replace(
      'normalized.',
      '',
    ) as keyof InstagramResearchEvidenceContract['normalized'];
    if (key in evidence.normalized && !Array.isArray(evidence.normalized[key])) {
      return valuesEqual(evidence.normalized[key], ref.value);
    }
  }

  return false;
}

/**
 * Rewrites LLM shorthand / invented evidence paths into allowlisted citations
 * that match the snapshot. Returns null when the citation cannot be grounded
 * (e.g. invented `postContent` with free-text value).
 */
export function repairEvidenceRef(
  evidence: InstagramResearchEvidenceContract,
  ref: EvidenceRef,
): EvidenceRef | null {
  const rawPath = ref.fieldPath.trim();
  const note = ref.note;

  const withNote = (resolved: EvidenceRef): EvidenceRef =>
    note ? { ...resolved, note } : resolved;

  const indexed = INDEXED_ARRAY_RE.exec(rawPath);
  if (indexed) {
    const arrayKey = indexed[1] as
      | 'postHashtags'
      | 'bioHashtags'
      | 'externalUrls';
    const preferredIndex = Number(indexed[2]);
    const resolved = resolveArrayRef(
      evidence,
      arrayKey,
      ref.value,
      preferredIndex,
    );
    if (resolved) {
      return withNote(resolved);
    }
    const relocated = searchAllArrays(evidence, ref.value);
    return relocated ? withNote(relocated) : null;
  }

  const arrayAlias = ARRAY_ALIASES[rawPath];
  if (arrayAlias) {
    const resolved = resolveArrayRef(evidence, arrayAlias, ref.value);
    if (resolved) {
      return withNote(resolved);
    }
    const relocated = searchAllArrays(evidence, ref.value);
    return relocated ? withNote(relocated) : null;
  }

  const scalarPath = SCALAR_ALIASES[rawPath];
  if (scalarPath) {
    const key = scalarPath.replace(
      'normalized.',
      '',
    ) as keyof InstagramResearchEvidenceContract['normalized'];
    const actual = evidence.normalized[key];
    if (valuesEqual(actual, ref.value)) {
      return withNote({ fieldPath: scalarPath, value: ref.value });
    }
    // Prefer canonical scalar when value is contained in biography text.
    if (
      typeof actual === 'string' &&
      typeof ref.value === 'string' &&
      normalizeComparableString(actual).includes(
        normalizeComparableString(ref.value),
      )
    ) {
      return withNote({ fieldPath: scalarPath, value: actual });
    }
    const relocated = searchAllArrays(evidence, ref.value);
    return relocated ? withNote(relocated) : null;
  }

  if (META_PATHS.has(rawPath)) {
    const actual = (evidence as Record<string, unknown>)[rawPath];
    if (valuesEqual(actual, ref.value)) {
      return withNote({ fieldPath: rawPath, value: ref.value });
    }
    return null;
  }

  // Invented paths (postContent, captions, etc.): keep only if value matches snapshot.
  const relocated = searchAllArrays(evidence, ref.value);
  return relocated ? withNote(relocated) : null;
}

function mapRefs(
  evidence: InstagramResearchEvidenceContract,
  refs: EvidenceRef[],
): EvidenceRef[] {
  const repaired: EvidenceRef[] = [];
  for (const ref of refs) {
    const next = repairEvidenceRef(evidence, ref);
    if (next && isAllowlistedResolvedRef(evidence, next)) {
      repaired.push(next);
    }
  }
  return repaired;
}

function pruneEmptyEvidenceItems<
  T extends { evidence: EvidenceRef[] },
>(items: T[]): T[] {
  return items.filter((item) => item.evidence.length > 0);
}

/**
 * Returns a copy of talentInterpretation with repaired evidence citations.
 * Drops ungroundable refs and claims left without evidence. If nothing
 * verifiable remains, marks insufficientEvidence=true (keeps IBP commercial
 * fields untouched — those live outside this object).
 */
export function repairTalentInterpretationEvidenceRefs(
  interpretation: TalentInterpretationOutput,
  evidence: InstagramResearchEvidenceContract | null,
): TalentInterpretationOutput {
  if (!evidence || interpretation.insufficientEvidence) {
    return interpretation;
  }

  const summary =
    interpretation.summary === null
      ? null
      : {
          ...interpretation.summary,
          evidence: mapRefs(evidence, interpretation.summary.evidence),
        };

  const niches = pruneEmptyEvidenceItems(
    interpretation.niches.map((item) => ({
      ...item,
      evidence: mapRefs(evidence, item.evidence),
    })),
  );
  const contentCategories = pruneEmptyEvidenceItems(
    interpretation.contentCategories.map((item) => ({
      ...item,
      evidence: mapRefs(evidence, item.evidence),
    })),
  );
  const commercialSignals = pruneEmptyEvidenceItems(
    interpretation.commercialSignals.map((item) => ({
      ...item,
      evidence: mapRefs(evidence, item.evidence),
    })),
  );

  const summaryOk =
    summary !== null && summary.evidence.length > 0 ? summary : null;

  const hasCollection =
    niches.length > 0 ||
    contentCategories.length > 0 ||
    commercialSignals.length > 0;

  if (!summaryOk && !hasCollection) {
    const limitations = [...interpretation.limitations];
    if (
      !limitations.some((line) =>
        /ungrounded|evidence|citation/i.test(line),
      )
    ) {
      limitations.push(
        'Model citations could not be grounded to Instagram research evidence fields.',
      );
    }
    return {
      outputVersion: '1.0',
      insufficientEvidence: true,
      summary: null,
      niches: [],
      contentCategories: [],
      commercialSignals: [],
      limitations,
    };
  }

  return {
    ...interpretation,
    summary: summaryOk,
    niches,
    contentCategories,
    commercialSignals,
  };
}
