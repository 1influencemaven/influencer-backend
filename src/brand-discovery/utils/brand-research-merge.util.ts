import type { BrandResearchBrandOutput } from '@influence-maven/ai-contracts';

import type { RawBrandCandidate } from '../interfaces/brand-source-provider.interface';
import type { NestResearchStatus } from './brand-research-validate.util';
import { dedupeResearchUrls } from './brand-research-pages.util';

export type DeepResearchMetadata = {
  researchStatus: NestResearchStatus;
  agentResearchStatus?: BrandResearchBrandOutput['researchStatus'];
  identity: BrandResearchBrandOutput['identity'];
  company: BrandResearchBrandOutput['company'];
  industry: BrandResearchBrandOutput['industry'];
  offerings: BrandResearchBrandOutput['offerings'];
  markets: BrandResearchBrandOutput['markets'];
  commercialSignals: BrandResearchBrandOutput['commercialSignals'];
  influencerFit: BrandResearchBrandOutput['influencerFit'];
  pages: Array<{
    url: string;
    role: string;
    fetchStatus: string;
    httpStatus?: number;
    errorMessage?: string;
  }>;
  warnings?: string[];
};

function isUsableField(status: string, value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === 'string' && !value.trim()) return false;
  return status === 'VERIFIED' || status === 'PARTIAL';
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const first = value.find(
      (v): v is string => typeof v === 'string' && Boolean(v.trim()),
    );
    return first?.trim();
  }
  return undefined;
}

/**
 * Merge Nest-owned deep research into a SCORE candidate.
 * Does NOT change Prisma evidenceStatus (SERP/grounding semantics).
 * Keeps SCORE score unless research provides valid score + non-empty rationale.
 */
export function mergeDeepResearchIntoCandidate(params: {
  candidate: RawBrandCandidate;
  nestResearchStatus: NestResearchStatus;
  agentOutput: BrandResearchBrandOutput | null;
  pages: DeepResearchMetadata['pages'];
  warnings?: string[];
}): RawBrandCandidate {
  const { candidate, nestResearchStatus, agentOutput, pages, warnings } =
    params;

  const pageOkUrls = pages
    .filter((p) => p.fetchStatus === 'ok')
    .map((p) => p.url);

  const deepResearch: DeepResearchMetadata = agentOutput
    ? {
        researchStatus: nestResearchStatus,
        agentResearchStatus: agentOutput.researchStatus,
        identity: agentOutput.identity,
        company: agentOutput.company,
        industry: agentOutput.industry,
        offerings: agentOutput.offerings,
        markets: agentOutput.markets,
        commercialSignals: agentOutput.commercialSignals,
        influencerFit: agentOutput.influencerFit,
        pages,
        ...(warnings?.length ? { warnings } : {}),
      }
    : {
        researchStatus: nestResearchStatus,
        identity: {
          name: { value: null, status: 'UNAVAILABLE', evidence: [] },
          officialWebsite: { value: null, status: 'UNAVAILABLE', evidence: [] },
          domain: { value: null, status: 'UNAVAILABLE', evidence: [] },
        },
        company: {
          description: { value: null, status: 'UNAVAILABLE', evidence: [] },
          brandSize: { value: null, status: 'UNAVAILABLE', evidence: [] },
        },
        industry: {
          sectors: { value: null, status: 'UNAVAILABLE', evidence: [] },
          categories: { value: null, status: 'UNAVAILABLE', evidence: [] },
        },
        offerings: {
          productsAndServices: {
            value: null,
            status: 'UNAVAILABLE',
            evidence: [],
          },
        },
        markets: {
          countriesOrRegions: {
            value: null,
            status: 'UNAVAILABLE',
            evidence: [],
          },
        },
        commercialSignals: [],
        influencerFit: {
          rationale: { value: null, status: 'UNAVAILABLE', evidence: [] },
        },
        pages,
        warnings: warnings ?? ['Deep research failed or unavailable'],
      };

  let sector = candidate.sector;
  let market = candidate.market;
  let brandSize = candidate.brandSize;
  let fitReason = candidate.fitReason;
  let score = candidate.score;

  if (agentOutput) {
    const sectors = agentOutput.industry.sectors;
    if (isUsableField(sectors.status, sectors.value)) {
      const next = firstString(sectors.value);
      if (next) sector = next;
    }
    const markets = agentOutput.markets.countriesOrRegions;
    if (isUsableField(markets.status, markets.value)) {
      const next = firstString(markets.value);
      if (next) market = next;
    }
    const size = agentOutput.company.brandSize;
    if (isUsableField(size.status, size.value) && size.value) {
      brandSize = size.value;
    }
    const rationale = agentOutput.influencerFit.rationale;
    if (isUsableField(rationale.status, rationale.value) && rationale.value) {
      fitReason = rationale.value;
    }

    const researchScore = agentOutput.influencerFit.score;
    const rationaleText = rationale.value?.trim() ?? '';
    const scoreValid =
      typeof researchScore === 'number' &&
      Number.isFinite(researchScore) &&
      researchScore >= 0 &&
      researchScore <= 100 &&
      rationaleText.length > 0 &&
      (rationale.status === 'VERIFIED' || rationale.status === 'PARTIAL');
    if (scoreValid) {
      score = researchScore;
    }
  }

  const prevMeta =
    candidate.metadata && typeof candidate.metadata === 'object'
      ? { ...candidate.metadata }
      : {};

  return {
    ...candidate,
    sector,
    market,
    brandSize,
    fitReason,
    score,
    // evidenceStatus intentionally unchanged (Prisma SERP/grounding semantics)
    evidenceUrls: dedupeResearchUrls([
      ...candidate.evidenceUrls,
      ...pageOkUrls,
    ]),
    metadata: {
      ...prevMeta,
      deepResearch,
    },
  };
}
