/** Canonical HU-TM-004 disclaimer when the LLM omits it on brand_reference. */
export const BRAND_REFERENCE_DEFAULT_DISCLAIMER =
  'Brand mention in evidence is not evidence of a paid sponsorship or partnership.';

export type EvidenceScalar = string | number | boolean | null;

/**
 * Local LLMs often emit arrays/objects as evidence.value (Zod "Invalid input").
 * Coerce to the strict scalar union without inventing commercial facts.
 */
export function coerceEvidenceValue(value: unknown): EvidenceScalar {
  if (value === undefined) {
    return null;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return null;
    }
    return coerceEvidenceValue(value[0]);
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function normalizeEvidenceRefs(refs: unknown): unknown {
  if (!Array.isArray(refs)) {
    return refs;
  }
  return refs.map((ref) => {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
      return ref;
    }
    const row = ref as Record<string, unknown>;
    return {
      ...row,
      value: coerceEvidenceValue(row.value),
    };
  });
}

function normalizeClassifiedList(items: unknown): unknown {
  if (!Array.isArray(items)) {
    return items;
  }
  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item;
    }
    const row = item as Record<string, unknown>;
    return {
      ...row,
      evidence: normalizeEvidenceRefs(row.evidence),
    };
  });
}

/**
 * Soft-repairs common local-LLM omissions before Zod parse.
 * - Coerces evidence.value arrays/objects → scalar
 * - Injects brand_reference disclaimer when missing
 */
export function normalizeIbpLlmObject(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }

  const root = raw as Record<string, unknown>;
  const talent = root.talentInterpretation;
  if (!talent || typeof talent !== 'object' || Array.isArray(talent)) {
    return raw;
  }

  const talentRecord = talent as Record<string, unknown>;
  let summary = talentRecord.summary;
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    const summaryRow = summary as Record<string, unknown>;
    summary = {
      ...summaryRow,
      evidence: normalizeEvidenceRefs(summaryRow.evidence),
    };
  }

  const niches = normalizeClassifiedList(talentRecord.niches);
  const contentCategories = normalizeClassifiedList(
    talentRecord.contentCategories,
  );

  const signals = talentRecord.commercialSignals;
  let commercialSignals = signals;
  if (Array.isArray(signals)) {
    commercialSignals = signals.map((signal) => {
      if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
        return signal;
      }
      const row = signal as Record<string, unknown>;
      const withEvidence = {
        ...row,
        evidence: normalizeEvidenceRefs(row.evidence),
      };
      if (row.type !== 'brand_reference') {
        return withEvidence;
      }
      const disclaimer =
        typeof row.disclaimer === 'string' ? row.disclaimer.trim() : '';
      if (disclaimer) {
        return withEvidence;
      }
      return {
        ...withEvidence,
        disclaimer: BRAND_REFERENCE_DEFAULT_DISCLAIMER,
      };
    });
  }

  return {
    ...root,
    talentInterpretation: {
      ...talentRecord,
      summary,
      niches,
      contentCategories,
      commercialSignals,
    },
  };
}

export function isIbpStructuredValidationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Structured output validation failed|ZodError|brand_reference requires disclaimer|Invalid input|invalid_type|AI_INVALID_OUTPUT/i.test(
    message,
  );
}
