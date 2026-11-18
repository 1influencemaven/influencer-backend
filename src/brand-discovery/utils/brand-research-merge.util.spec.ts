import { mergeDeepResearchIntoCandidate } from './brand-research-merge.util';
import type { RawBrandCandidate } from '../interfaces/brand-source-provider.interface';

const baseCandidate = (): RawBrandCandidate => ({
  name: 'Demo',
  website: 'https://demo.example',
  domain: 'demo.example',
  sector: 'software',
  market: 'Global',
  brandSize: 'smb',
  score: 80,
  fitReason: 'score fit',
  source: 'mastra',
  evidenceUrls: ['https://demo.example/serp'],
  evidenceStatus: 'VERIFIED',
  groundingSource: 'SEARCH_EVIDENCE',
  metadata: {
    groundingSource: 'SEARCH_EVIDENCE',
    groundingProvenance: { serpMatched: true, seedMatched: false },
  },
});

const emptyField = {
  value: null as null,
  status: 'NOT_FOUND' as const,
  evidence: [] as [],
};

describe('mergeDeepResearchIntoCandidate', () => {
  it('keeps Prisma evidenceStatus and SCORE score when research has no score', () => {
    const merged = mergeDeepResearchIntoCandidate({
      candidate: baseCandidate(),
      nestResearchStatus: 'PARTIAL',
      agentOutput: {
        operation: 'RESEARCH_BRAND',
        researchStatus: 'PARTIAL',
        identity: {
          name: {
            value: 'Demo',
            status: 'VERIFIED',
            evidence: [{ url: 'https://demo.example/' }],
          },
          officialWebsite: {
            value: 'https://demo.example',
            status: 'VERIFIED',
            evidence: [{ url: 'https://demo.example/' }],
          },
          domain: {
            value: 'demo.example',
            status: 'VERIFIED',
            evidence: [{ url: 'https://demo.example/' }],
          },
        },
        company: { description: emptyField, brandSize: emptyField },
        industry: {
          sectors: {
            value: ['wellness'],
            status: 'VERIFIED',
            evidence: [{ url: 'https://demo.example/' }],
          },
          categories: emptyField,
        },
        offerings: { productsAndServices: emptyField },
        markets: { countriesOrRegions: emptyField },
        commercialSignals: [],
        influencerFit: {
          rationale: {
            value: 'ok',
            status: 'PARTIAL',
            evidence: [{ url: 'https://demo.example/' }],
          },
        },
        pages: [],
      },
      pages: [
        {
          url: 'https://demo.example/',
          role: 'homepage',
          fetchStatus: 'ok',
          httpStatus: 200,
        },
      ],
    });

    expect(merged.evidenceStatus).toBe('VERIFIED');
    expect(merged.score).toBe(80);
    expect(merged.sector).toBe('wellness');
    expect(
      (merged.metadata as { deepResearch: { researchStatus: string } })
        .deepResearch.researchStatus,
    ).toBe('PARTIAL');
    expect(merged.evidenceUrls).toContain('https://demo.example/');
  });

  it('updates score only with valid score and rationale', () => {
    const merged = mergeDeepResearchIntoCandidate({
      candidate: baseCandidate(),
      nestResearchStatus: 'COMPLETED',
      agentOutput: {
        operation: 'RESEARCH_BRAND',
        researchStatus: 'COMPLETED',
        identity: {
          name: emptyField,
          officialWebsite: emptyField,
          domain: emptyField,
        },
        company: { description: emptyField, brandSize: emptyField },
        industry: { sectors: emptyField, categories: emptyField },
        offerings: { productsAndServices: emptyField },
        markets: { countriesOrRegions: emptyField },
        commercialSignals: [],
        influencerFit: {
          score: 66,
          rationale: {
            value: 'Strong fit with IBP',
            status: 'VERIFIED',
            evidence: [{ url: 'https://demo.example/' }],
          },
        },
        pages: [],
      },
      pages: [
        {
          url: 'https://demo.example/',
          role: 'homepage',
          fetchStatus: 'ok',
        },
      ],
    });
    expect(merged.score).toBe(66);
    expect(merged.fitReason).toBe('Strong fit with IBP');
  });

  it('does not apply a minimum score threshold', () => {
    const merged = mergeDeepResearchIntoCandidate({
      candidate: { ...baseCandidate(), score: 10 },
      nestResearchStatus: 'COMPLETED',
      agentOutput: {
        operation: 'RESEARCH_BRAND',
        researchStatus: 'COMPLETED',
        identity: {
          name: emptyField,
          officialWebsite: emptyField,
          domain: emptyField,
        },
        company: { description: emptyField, brandSize: emptyField },
        industry: { sectors: emptyField, categories: emptyField },
        offerings: { productsAndServices: emptyField },
        markets: { countriesOrRegions: emptyField },
        commercialSignals: [],
        influencerFit: {
          score: 5,
          rationale: {
            value: 'Weak but valid',
            status: 'PARTIAL',
            evidence: [{ url: 'https://demo.example/' }],
          },
        },
        pages: [],
      },
      pages: [
        { url: 'https://demo.example/', role: 'homepage', fetchStatus: 'ok' },
      ],
    });
    expect(merged.score).toBe(5);
  });
});
