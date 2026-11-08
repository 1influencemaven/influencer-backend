import type { ScoredBrand } from '@influence-maven/ai-contracts';

import type { IbpCriteriaSnapshot } from '../interfaces/brand-source-provider.interface';
import { normalizeDomain } from './brand-domain.util';
import {
  buildBrandEvidenceAllowlist,
  isEvidenceUrlAuthorized,
  type BrandEvidenceAllowlistInput,
} from './brand-evidence-filter.util';

/**
 * Nest-assigned provenance for a scored brand (AI-004.5.1.2).
 * Never trusted from Mastra output.
 */
export type BrandGroundingSource =
  | 'SEARCH_EVIDENCE'
  | 'SEED_EVIDENCE'
  | 'MODEL_PRIOR';

/** Domain vocabulary for Brand Discovery brandSize (IBP prompt / Settings). */
export const BRAND_DISCOVERY_ALLOWED_BRAND_SIZES = [
  'startup',
  'smb',
  'mid_market',
  'enterprise',
] as const;

export type AllowedBrandSize =
  (typeof BRAND_DISCOVERY_ALLOWED_BRAND_SIZES)[number];

export const MODEL_PRIOR_FIT_REASON =
  'Empresa identificada mediante conocimiento previo del modelo. Presenta una posible compatibilidad con el IBP, pero no se ha encontrado evidencia externa de un programa de colaboración.';

const SCORE_CAP_SEARCH = 100;
const SCORE_CAP_SEED_VERIFIED = 100;
const SCORE_CAP_SEED_UNVERIFIED = 80;
const SCORE_CAP_MODEL_PRIOR = 55;
/** Extra soft cap when IBP prefers smb/startup/mid_market but size is enterprise. */
const SCORE_CAP_SIZE_INCONSISTENCY = 50;

const COMMERCIAL_PROGRAM_CLAIM =
  /\b(affiliate\s+program|sponsorship|sponsored\s+content|creator\s+program|ambassador\s+program|influencer\s+program|ugc\s+program|influencer\s+partnerships?|creator\s+collaborations?)\b/i;

export type BrandCandidateGroundingMetadata = {
  groundingSource: BrandGroundingSource;
  groundingProvenance: {
    serpMatched: boolean;
    seedMatched: boolean;
  };
  ibpBrandSizeInconsistency?: boolean;
};

export type GroundedBrandCandidateFields = {
  name: string;
  website: string;
  domain: string;
  sector?: string;
  market?: string;
  brandSize?: string;
  score: number;
  fitReason: string;
  evidenceUrls: string[];
  evidenceStatus: 'VERIFIED' | 'UNVERIFIED';
  groundingSource: BrandGroundingSource;
  metadata: BrandCandidateGroundingMetadata;
};

function normalizeBrandSizeToken(raw: string | undefined): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  let value = raw.trim().toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
  if (value === 'midmarket' || value === 'mid') {
    value = 'mid_market';
  }
  if (value === 'sme') {
    value = 'smb';
  }
  return value;
}

/**
 * Returns a domain-allowed brandSize or undefined (unknown) if invalid.
 */
export function sanitizeBrandSize(
  raw: string | undefined,
): AllowedBrandSize | undefined {
  const normalized = normalizeBrandSizeToken(raw);
  if (!normalized) {
    return undefined;
  }
  return (BRAND_DISCOVERY_ALLOWED_BRAND_SIZES as readonly string[]).includes(
    normalized,
  )
    ? (normalized as AllowedBrandSize)
    : undefined;
}

export function detectIbpBrandSizeInconsistency(
  ibp: IbpCriteriaSnapshot,
  brandSize: AllowedBrandSize | undefined,
): boolean {
  if (!brandSize || brandSize !== 'enterprise') {
    return false;
  }
  const preferred = new Set(
    ibp.brandSize.map((s) => normalizeBrandSizeToken(s)).filter(Boolean),
  );
  const wantsSmall =
    preferred.has('smb') ||
    preferred.has('startup') ||
    preferred.has('mid_market');
  const wantsEnterprise = preferred.has('enterprise');
  return wantsSmall && !wantsEnterprise;
}

function domainInAllowlist(
  website: string,
  allowlist: ReturnType<typeof buildBrandEvidenceAllowlist>,
): boolean {
  const domain = normalizeDomain(website);
  return Boolean(domain && allowlist.domains.has(domain));
}

/**
 * Precedence: SEARCH_EVIDENCE > SEED_EVIDENCE > MODEL_PRIOR.
 * When both SERP and seed match, SEARCH wins; provenance keeps both flags.
 */
export function resolveGroundingSource(params: {
  website: string;
  evidenceUrls: ReadonlyArray<string>;
  searchHits?: BrandEvidenceAllowlistInput['searchHits'];
  seedBrands?: BrandEvidenceAllowlistInput['seedBrands'];
}): {
  groundingSource: BrandGroundingSource;
  serpMatched: boolean;
  seedMatched: boolean;
} {
  const serpAllowlist = buildBrandEvidenceAllowlist({
    searchHits: params.searchHits,
    seedBrands: [],
  });
  const seedAllowlist = buildBrandEvidenceAllowlist({
    searchHits: [],
    seedBrands: params.seedBrands,
  });

  const serpMatched =
    domainInAllowlist(params.website, serpAllowlist) ||
    params.evidenceUrls.some((url) =>
      isEvidenceUrlAuthorized(url, serpAllowlist),
    );
  const seedMatched =
    domainInAllowlist(params.website, seedAllowlist) ||
    params.evidenceUrls.some((url) =>
      isEvidenceUrlAuthorized(url, seedAllowlist),
    );

  if (serpMatched) {
    return {
      groundingSource: 'SEARCH_EVIDENCE',
      serpMatched: true,
      seedMatched,
    };
  }
  if (seedMatched) {
    return {
      groundingSource: 'SEED_EVIDENCE',
      serpMatched: false,
      seedMatched: true,
    };
  }
  return {
    groundingSource: 'MODEL_PRIOR',
    serpMatched: false,
    seedMatched: false,
  };
}

export function scoreCapForGrounding(
  groundingSource: BrandGroundingSource,
  evidenceStatus: 'VERIFIED' | 'UNVERIFIED',
): number {
  if (groundingSource === 'SEARCH_EVIDENCE') {
    return SCORE_CAP_SEARCH;
  }
  if (groundingSource === 'SEED_EVIDENCE') {
    return evidenceStatus === 'VERIFIED'
      ? SCORE_CAP_SEED_VERIFIED
      : SCORE_CAP_SEED_UNVERIFIED;
  }
  return SCORE_CAP_MODEL_PRIOR;
}

export function applyScoreCap(score: number, cap: number): number {
  const n = Number.isFinite(score) ? score : 0;
  return Math.min(Math.max(0, n), cap);
}

export function hasUnsupportedCommercialClaim(fitReason: string): boolean {
  return COMMERCIAL_PROGRAM_CLAIM.test(fitReason);
}

export function resolveFitReason(params: {
  groundingSource: BrandGroundingSource;
  evidenceUrls: ReadonlyArray<string>;
  llmFitReason: string;
}): string {
  if (params.groundingSource === 'MODEL_PRIOR') {
    return MODEL_PRIOR_FIT_REASON;
  }
  if (
    params.evidenceUrls.length === 0 &&
    hasUnsupportedCommercialClaim(params.llmFitReason)
  ) {
    return MODEL_PRIOR_FIT_REASON;
  }
  const trimmed = params.llmFitReason?.trim();
  return trimmed || MODEL_PRIOR_FIT_REASON;
}

/**
 * Enrich a post-classifier brand with Nest grounding, score caps, brandSize, fitReason.
 */
export function enrichScoredBrandForPersistence(params: {
  brand: ScoredBrand;
  evidenceStatus: 'VERIFIED' | 'UNVERIFIED';
  searchHits?: BrandEvidenceAllowlistInput['searchHits'];
  seedBrands?: BrandEvidenceAllowlistInput['seedBrands'];
  ibp: IbpCriteriaSnapshot;
  website: string;
  domain: string;
}): GroundedBrandCandidateFields {
  const evidenceUrls =
    params.evidenceStatus === 'VERIFIED' ? [...params.brand.evidenceUrls] : [];

  const { groundingSource, serpMatched, seedMatched } = resolveGroundingSource({
    website: params.website,
    evidenceUrls,
    searchHits: params.searchHits,
    seedBrands: params.seedBrands,
  });

  const brandSize = sanitizeBrandSize(params.brand.brandSize);
  const ibpBrandSizeInconsistency = detectIbpBrandSizeInconsistency(
    params.ibp,
    brandSize,
  );

  let cap = scoreCapForGrounding(groundingSource, params.evidenceStatus);
  if (ibpBrandSizeInconsistency) {
    cap = Math.min(cap, SCORE_CAP_SIZE_INCONSISTENCY);
  }

  const score = applyScoreCap(params.brand.score, cap);
  const fitReason = resolveFitReason({
    groundingSource,
    evidenceUrls,
    llmFitReason: params.brand.fitReason,
  });

  const metadata: BrandCandidateGroundingMetadata = {
    groundingSource,
    groundingProvenance: { serpMatched, seedMatched },
    ...(ibpBrandSizeInconsistency ? { ibpBrandSizeInconsistency: true } : {}),
  };

  return {
    name: params.brand.name,
    website: params.website,
    domain: params.domain,
    sector: params.brand.sector,
    market: params.brand.market,
    brandSize,
    score,
    fitReason,
    evidenceUrls,
    evidenceStatus: params.evidenceStatus,
    groundingSource,
    metadata,
  };
}
