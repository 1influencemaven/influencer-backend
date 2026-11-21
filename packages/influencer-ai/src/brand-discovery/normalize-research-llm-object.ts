/**
 * Soft-repair RESEARCH_BRAND LLM JSON before strict Zod parse.
 * Mirrors IBP `normalizeIbpLlmObject`: coerce common small-model shape mistakes
 * without inventing commercial facts.
 */

const AGENT_STATUSES = new Set(['COMPLETED', 'PARTIAL', 'FAILED']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Map confused field-level statuses onto agent researchStatus.
 * VERIFIED → COMPLETED (most common qwen failure).
 */
export function coerceResearchAgentStatus(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if (AGENT_STATUSES.has(normalized)) {
    return normalized;
  }
  if (normalized === 'VERIFIED' || normalized === 'SUCCESS' || normalized === 'OK') {
    return 'COMPLETED';
  }
  if (
    normalized === 'NOT_FOUND' ||
    normalized === 'UNAVAILABLE' ||
    normalized === 'INCOMPLETE'
  ) {
    return 'PARTIAL';
  }
  return raw;
}

/**
 * `identity.name` (and similar) must be a researched field object; LLMs often emit a bare string.
 */
export function coerceResearchedField(raw: unknown): unknown {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { value: null, status: 'NOT_FOUND', evidence: [] };
    }
    return { value: trimmed, status: 'VERIFIED', evidence: [] };
  }
  if (!isPlainObject(raw)) {
    return raw;
  }

  const out: Record<string, unknown> = {
    value: raw.value === undefined ? null : raw.value,
    status: raw.status,
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
  };
  if (typeof raw.note === 'string' && raw.note.trim() !== '') {
    out.note = raw.note;
  }
  // Drop note: null / empty — Zod optional rejects null without nullish transform.
  return out;
}

function coerceCommercialSignal(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }
  const out: Record<string, unknown> = { ...raw };
  if (out.note == null || out.note === '') {
    delete out.note;
  } else if (typeof out.note !== 'string') {
    out.note = String(out.note);
  }
  if (!Array.isArray(out.evidence)) {
    out.evidence = [];
  }
  return out;
}

function coercePage(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }
  const out: Record<string, unknown> = { ...raw };
  if (out.errorMessage == null || out.errorMessage === '') {
    delete out.errorMessage;
  } else if (typeof out.errorMessage !== 'string') {
    out.errorMessage = String(out.errorMessage).slice(0, 240);
  }
  return out;
}

function coerceIdentity(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }
  return {
    ...raw,
    name: coerceResearchedField(raw.name),
    officialWebsite: coerceResearchedField(raw.officialWebsite),
    domain: coerceResearchedField(raw.domain),
  };
}

function coerceCompany(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }
  return {
    ...raw,
    description: coerceResearchedField(raw.description),
    brandSize: coerceResearchedField(raw.brandSize),
  };
}

function coerceIndustry(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }
  return {
    ...raw,
    sectors: coerceResearchedField(raw.sectors),
    categories: coerceResearchedField(raw.categories),
  };
}

function coerceOfferings(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }
  return {
    ...raw,
    productsAndServices: coerceResearchedField(raw.productsAndServices),
  };
}

function coerceMarkets(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }
  return {
    ...raw,
    countriesOrRegions: coerceResearchedField(raw.countriesOrRegions),
  };
}

function coerceInfluencerFit(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }
  const out: Record<string, unknown> = {
    ...raw,
    rationale: coerceResearchedField(raw.rationale),
  };
  if (raw.alignmentNotes !== undefined) {
    out.alignmentNotes = coerceResearchedField(raw.alignmentNotes);
  }
  return out;
}

/**
 * Normalize a RESEARCH_BRAND LLM object (without `operation`) for strict parse.
 */
export function normalizeResearchLlmObject(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }

  const out: Record<string, unknown> = { ...raw };
  out.researchStatus = coerceResearchAgentStatus(raw.researchStatus);
  out.identity = coerceIdentity(raw.identity);
  out.company = coerceCompany(raw.company);
  out.industry = coerceIndustry(raw.industry);
  out.offerings = coerceOfferings(raw.offerings);
  out.markets = coerceMarkets(raw.markets);
  out.influencerFit = coerceInfluencerFit(raw.influencerFit);

  if (Array.isArray(raw.commercialSignals)) {
    out.commercialSignals = raw.commercialSignals.map(coerceCommercialSignal);
  } else if (raw.commercialSignals == null) {
    out.commercialSignals = [];
  }

  if (Array.isArray(raw.pages)) {
    out.pages = raw.pages.map(coercePage);
  } else if (raw.pages == null) {
    out.pages = [];
  }

  return out;
}
