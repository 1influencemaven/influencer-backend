import {
  brandDiscoveryInputSchema,
  brandDiscoveryOutputSchema,
  brandCommercialSignalSchema,
} from './brand-discovery';

const ibp = {
  targetSectors: ['wellness'],
  excludedSectors: ['gambling'],
  brandSize: ['smb'],
  markets: ['Spain'],
  collaborationTypes: ['brand ambassador'],
  summary: 'Marcas wellness',
  alertSignals: [],
  desirableCriteria: ['sustainability'],
};

const emptyField = {
  value: null,
  status: 'NOT_FOUND' as const,
  evidence: [] as [],
};

describe('brand-discovery RESEARCH_BRAND contracts', () => {
  it('parses RESEARCH_BRAND input with page snapshots (max 4)', () => {
    const parsed = brandDiscoveryInputSchema.parse({
      operation: 'RESEARCH_BRAND',
      influencerName: 'Ana Fit',
      niche: 'fitness',
      ibp,
      brand: {
        name: 'Demo Co',
        website: 'https://demo.example',
        domain: 'demo.example',
      },
      pageSnapshots: [
        {
          url: 'https://demo.example/',
          role: 'homepage',
          textContent: 'Welcome to Demo Co',
        },
      ],
      maxPages: 4,
    });
    expect(parsed.operation).toBe('RESEARCH_BRAND');
    if (parsed.operation === 'RESEARCH_BRAND') {
      expect(parsed.pageSnapshots).toHaveLength(1);
      expect(parsed.maxPages).toBe(4);
    }
  });

  it('rejects more than 4 page snapshots', () => {
    const snap = {
      url: 'https://demo.example/',
      role: 'homepage' as const,
      textContent: 'x',
    };
    const result = brandDiscoveryInputSchema.safeParse({
      operation: 'RESEARCH_BRAND',
      influencerName: 'Ana Fit',
      ibp,
      brand: {
        name: 'Demo Co',
        website: 'https://demo.example',
        domain: 'demo.example',
      },
      pageSnapshots: [snap, snap, snap, snap, snap],
      maxPages: 4,
    });
    expect(result.success).toBe(false);
  });

  it('parses RESEARCH_BRAND output with optional score and structured signals', () => {
    const parsed = brandDiscoveryOutputSchema.parse({
      operation: 'RESEARCH_BRAND',
      researchStatus: 'PARTIAL',
      identity: {
        name: {
          value: 'Demo Co',
          status: 'VERIFIED',
          evidence: [{ url: 'https://demo.example/', excerpt: 'Demo Co' }],
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
      company: {
        description: {
          value: 'A wellness brand',
          status: 'PARTIAL',
          evidence: [{ url: 'https://demo.example/' }],
        },
        brandSize: emptyField,
      },
      industry: {
        sectors: {
          value: ['wellness'],
          status: 'PARTIAL',
          evidence: [{ url: 'https://demo.example/' }],
        },
        categories: emptyField,
      },
      offerings: {
        productsAndServices: emptyField,
      },
      markets: {
        countriesOrRegions: emptyField,
      },
      commercialSignals: [
        {
          kind: 'affiliate',
          value: null,
          status: 'NOT_FOUND',
          evidence: [],
          note: 'No affiliate mention in consulted pages',
        },
        {
          kind: 'influencer_marketing',
          value: true,
          status: 'VERIFIED',
          evidence: [
            {
              url: 'https://demo.example/creators',
              excerpt: 'Creator partnerships',
            },
          ],
        },
      ],
      influencerFit: {
        rationale: {
          value: 'Niche overlap with fitness audience',
          status: 'PARTIAL',
          evidence: [{ url: 'https://demo.example/' }],
        },
      },
      pages: [
        {
          url: 'https://demo.example/',
          role: 'homepage',
          fetchStatus: 'ok',
          httpStatus: 200,
        },
      ],
      warnings: ['Only homepage available'],
    });

    expect(parsed.operation).toBe('RESEARCH_BRAND');
    if (parsed.operation === 'RESEARCH_BRAND') {
      expect(parsed.influencerFit.score).toBeUndefined();
      expect(parsed.commercialSignals[0].kind).toBe('affiliate');
      expect(parsed.commercialSignals[0].value).toBeNull();
    }
  });

  it('allows optional influencerFit.score when present', () => {
    const base = brandDiscoveryOutputSchema.parse({
      operation: 'RESEARCH_BRAND',
      researchStatus: 'COMPLETED',
      identity: {
        name: { value: 'X', status: 'VERIFIED', evidence: [] },
        officialWebsite: { value: 'https://x.example', status: 'VERIFIED', evidence: [] },
        domain: { value: 'x.example', status: 'VERIFIED', evidence: [] },
      },
      company: {
        description: emptyField,
        brandSize: emptyField,
      },
      industry: { sectors: emptyField, categories: emptyField },
      offerings: { productsAndServices: emptyField },
      markets: { countriesOrRegions: emptyField },
      commercialSignals: [],
      influencerFit: {
        score: 71,
        rationale: {
          value: 'Good fit',
          status: 'VERIFIED',
          evidence: [{ url: 'https://x.example/' }],
        },
      },
      pages: [
        { url: 'https://x.example/', role: 'homepage', fetchStatus: 'ok' },
      ],
    });
    expect(base.operation).toBe('RESEARCH_BRAND');
    if (base.operation === 'RESEARCH_BRAND') {
      expect(base.influencerFit.score).toBe(71);
    }
  });

  it('keeps PLAN_SEARCH and SCORE_CANDIDATES parseable (additive 1.0)', () => {
    expect(
      brandDiscoveryInputSchema.parse({
        operation: 'PLAN_SEARCH',
        influencerName: 'Ana',
        ibp,
        maxQueries: 2,
      }).operation,
    ).toBe('PLAN_SEARCH');

    expect(
      brandDiscoveryOutputSchema.parse({
        operation: 'SCORE_CANDIDATES',
        brands: [
          {
            name: 'A',
            website: 'https://a.example',
            score: 50,
            fitReason: 'ok',
            evidenceUrls: [],
          },
        ],
      }).operation,
    ).toBe('SCORE_CANDIDATES');
  });

  it('requires structured commercialSignal fields', () => {
    const bad = brandCommercialSignalSchema.safeParse({
      kind: 'affiliate',
      note: 'maybe',
    });
    expect(bad.success).toBe(false);
  });

  it('accepts null note/errorMessage and strips them', () => {
    const parsed = brandDiscoveryOutputSchema.parse({
      operation: 'RESEARCH_BRAND',
      researchStatus: 'COMPLETED',
      identity: {
        name: {
          value: 'X',
          status: 'VERIFIED',
          evidence: [],
          note: null,
        },
        officialWebsite: {
          value: 'https://x.example',
          status: 'VERIFIED',
          evidence: [],
          note: null,
        },
        domain: {
          value: 'x.example',
          status: 'VERIFIED',
          evidence: [],
          note: null,
        },
      },
      company: {
        description: emptyField,
        brandSize: emptyField,
      },
      industry: { sectors: emptyField, categories: emptyField },
      offerings: { productsAndServices: emptyField },
      markets: { countriesOrRegions: emptyField },
      commercialSignals: [
        {
          kind: 'affiliate',
          value: null,
          status: 'NOT_FOUND',
          evidence: [],
          note: null,
        },
      ],
      influencerFit: {
        rationale: {
          value: 'ok',
          status: 'PARTIAL',
          evidence: [],
          note: null,
        },
      },
      pages: [
        {
          url: 'https://x.example/',
          role: 'homepage',
          fetchStatus: 'ok',
          errorMessage: null,
        },
      ],
    });
    expect(parsed.operation).toBe('RESEARCH_BRAND');
    if (parsed.operation === 'RESEARCH_BRAND') {
      expect(parsed.identity.name.note).toBeUndefined();
      expect(parsed.pages[0]?.errorMessage).toBeUndefined();
      expect(parsed.commercialSignals[0]?.note).toBeUndefined();
    }
  });
});
