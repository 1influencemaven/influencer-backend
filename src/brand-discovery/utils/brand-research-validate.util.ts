import type {
  BrandResearchBrandOutput,
  BrandResearchEvidenceRef,
} from '@influence-maven/ai-contracts';

import { canonicalizeEvidenceUrl } from './brand-evidence-filter.util';

function urlKey(url: string): string | null {
  return canonicalizeEvidenceUrl(url);
}

type ValueField<V> = {
  value: V | null;
  status: BrandResearchBrandOutput['identity']['name']['status'];
  evidence: BrandResearchEvidenceRef[];
  note?: string;
};

function scrubRefs(
  refs: BrandResearchEvidenceRef[],
  allow: ReadonlySet<string>,
): BrandResearchEvidenceRef[] {
  return refs.filter((ref) => {
    const key = urlKey(ref.url);
    return key != null && allow.has(key);
  });
}

function scrubValueField<V>(
  field: ValueField<V>,
  allow: ReadonlySet<string>,
): ValueField<V> {
  const evidence = scrubRefs(field.evidence, allow);
  if (
    evidence.length === 0 &&
    (field.status === 'VERIFIED' || field.status === 'PARTIAL') &&
    field.evidence.length > 0
  ) {
    return {
      ...field,
      value: null,
      status: 'UNAVAILABLE',
      evidence: [],
    };
  }
  return { ...field, evidence };
}

/**
 * Strip evidence refs whose URL is not in the Nest-fetched allowlist.
 * Downgrade field status to UNAVAILABLE when VERIFIED/PARTIAL left with no evidence.
 */
export function scrubOrphanEvidence(
  output: BrandResearchBrandOutput,
  allowedUrls: ReadonlyArray<string>,
): BrandResearchBrandOutput {
  const allow = new Set(
    allowedUrls.map(urlKey).filter((k): k is string => Boolean(k)),
  );

  return {
    ...output,
    identity: {
      name: scrubValueField(output.identity.name, allow),
      officialWebsite: scrubValueField(output.identity.officialWebsite, allow),
      domain: scrubValueField(output.identity.domain, allow),
    },
    company: {
      description: scrubValueField(output.company.description, allow),
      brandSize: scrubValueField(output.company.brandSize, allow),
    },
    industry: {
      sectors: scrubValueField(output.industry.sectors, allow),
      categories: scrubValueField(output.industry.categories, allow),
    },
    offerings: {
      productsAndServices: scrubValueField(
        output.offerings.productsAndServices,
        allow,
      ),
    },
    markets: {
      countriesOrRegions: scrubValueField(
        output.markets.countriesOrRegions,
        allow,
      ),
    },
    commercialSignals: output.commercialSignals.map((signal) => {
      const evidence = scrubRefs(signal.evidence, allow);
      if (
        evidence.length === 0 &&
        (signal.status === 'VERIFIED' || signal.status === 'PARTIAL') &&
        signal.evidence.length > 0
      ) {
        return {
          ...signal,
          value: null,
          status: 'UNAVAILABLE' as const,
          evidence: [],
        };
      }
      return { ...signal, evidence };
    }),
    influencerFit: {
      ...output.influencerFit,
      rationale: scrubValueField(output.influencerFit.rationale, allow),
      alignmentNotes: output.influencerFit.alignmentNotes
        ? scrubValueField(output.influencerFit.alignmentNotes, allow)
        : undefined,
    },
    pages: output.pages.slice(0, 4),
  };
}

export type NestResearchStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED';

/**
 * Nest-owned final research status from downloads + (optional) agent output.
 */
export function computeNestResearchStatus(params: {
  pagesOk: number;
  pagesAttempted: number;
  agentOutput: BrandResearchBrandOutput | null;
  agentFailed: boolean;
}): NestResearchStatus {
  if (params.pagesOk === 0 || params.agentFailed || !params.agentOutput) {
    return 'FAILED';
  }
  if (params.pagesOk < params.pagesAttempted) {
    return 'PARTIAL';
  }
  if (params.agentOutput.researchStatus === 'COMPLETED') {
    return 'COMPLETED';
  }
  // Agent PARTIAL/FAILED with usable pages → still PARTIAL for Nest (candidate kept)
  return 'PARTIAL';
}
