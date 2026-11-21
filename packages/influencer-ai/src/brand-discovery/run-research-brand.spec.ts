import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import { runBrandDiscoveryResearchBrand } from './run-research-brand';

const baseRequest = {
  contractVersion: AI_CONTRACT_VERSION,
  executionId: '11111111-1111-4111-8111-111111111111',
  correlationId: '22222222-2222-4222-8222-222222222222',
  idempotencyKey: 'brand-research:test',
  requestedAt: '2026-11-14T18:00:00.000Z',
  type: 'BRAND_DISCOVERY' as const,
  context: {
    userId: 'system:brand-discovery',
    influencerId: 'inf-1',
    resourceId: 'run-1',
    resourceType: 'BRAND_DISCOVERY_RUN' as const,
  },
  instructions: { business: 'Be careful' },
  input: {
    operation: 'RESEARCH_BRAND' as const,
    influencerName: 'Ana Fit',
    niche: 'fitness',
    ibp: {
      targetSectors: ['wellness'],
      excludedSectors: [],
      brandSize: ['smb'],
      markets: ['Spain'],
      collaborationTypes: [],
      summary: 'x',
      alertSignals: [],
      desirableCriteria: [],
    },
    brand: {
      name: 'Demo',
      website: 'https://demo.example',
      domain: 'demo.example',
    },
    pageSnapshots: [
      {
        url: 'https://demo.example/',
        role: 'homepage' as const,
        textContent: 'Demo wellness sportswear brand',
      },
    ],
    maxPages: 4,
  },
};

const validObject = {
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
  company: {
    description: {
      value: 'sportswear',
      status: 'PARTIAL',
      evidence: [{ url: 'https://demo.example/' }],
    },
    brandSize: { value: null, status: 'NOT_FOUND', evidence: [] },
  },
  industry: {
    sectors: {
      value: ['wellness'],
      status: 'PARTIAL',
      evidence: [{ url: 'https://demo.example/' }],
    },
    categories: { value: null, status: 'NOT_FOUND', evidence: [] },
  },
  offerings: {
    productsAndServices: { value: null, status: 'NOT_FOUND', evidence: [] },
  },
  markets: {
    countriesOrRegions: { value: null, status: 'NOT_FOUND', evidence: [] },
  },
  commercialSignals: [
    {
      kind: 'affiliate',
      value: null,
      status: 'NOT_FOUND',
      evidence: [],
    },
  ],
  influencerFit: {
    rationale: {
      value: 'Niche overlap',
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
};

describe('runBrandDiscoveryResearchBrand', () => {
  it('rejects non-RESEARCH operations', async () => {
    const agent = { generate: jest.fn() };
    const result = await runBrandDiscoveryResearchBrand(agent as never, {
      ...baseRequest,
      input: {
        operation: 'PLAN_SEARCH',
        influencerName: 'Ana',
        ibp: baseRequest.input.ibp,
        maxQueries: 2,
      },
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INTERNAL_ERROR');
    }
    expect(agent.generate).not.toHaveBeenCalled();
  });

  it('assembles RESEARCH_BRAND output from structured object', async () => {
    const agent = {
      generate: jest.fn().mockResolvedValue({ object: validObject, text: '' }),
    };
    const result = await runBrandDiscoveryResearchBrand(
      agent as never,
      baseRequest as never,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.operation).toBe('RESEARCH_BRAND');
      expect(result.output.commercialSignals[0].kind).toBe('affiliate');
      expect(result.llmCallCount).toBe(1);
    }
  });

  it('retries once on invalid structured output', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: { bad: true }, text: '{bad}' })
        .mockResolvedValueOnce({ object: validObject, text: '' }),
    };
    const result = await runBrandDiscoveryResearchBrand(
      agent as never,
      baseRequest as never,
    );
    expect(result.ok).toBe(true);
    expect(agent.generate).toHaveBeenCalledTimes(2);
  });

  it('soft-repairs Example-Company-shaped LLM output without retry', async () => {
    const messy = {
      researchStatus: 'VERIFIED',
      identity: {
        name: 'Demo',
        officialWebsite: {
          value: 'https://demo.example',
          status: 'VERIFIED',
          evidence: [{ url: 'https://demo.example/' }],
          note: null,
        },
        domain: {
          value: 'demo.example',
          status: 'VERIFIED',
          evidence: [{ url: 'https://demo.example/' }],
          note: null,
        },
      },
      company: {
        description: {
          value: 'sportswear',
          status: 'PARTIAL',
          evidence: [{ url: 'https://demo.example/' }],
          note: null,
        },
        brandSize: { value: null, status: 'NOT_FOUND', evidence: [], note: null },
      },
      industry: {
        sectors: {
          value: ['wellness'],
          status: 'PARTIAL',
          evidence: [{ url: 'https://demo.example/' }],
          note: null,
        },
        categories: { value: null, status: 'NOT_FOUND', evidence: [], note: null },
      },
      offerings: {
        productsAndServices: {
          value: null,
          status: 'NOT_FOUND',
          evidence: [],
          note: null,
        },
      },
      markets: {
        countriesOrRegions: {
          value: null,
          status: 'NOT_FOUND',
          evidence: [],
          note: null,
        },
      },
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
          value: 'Niche overlap',
          status: 'PARTIAL',
          evidence: [{ url: 'https://demo.example/' }],
          note: null,
        },
      },
      pages: [
        {
          url: 'https://demo.example/',
          role: 'homepage',
          fetchStatus: 'ok',
          httpStatus: 200,
          errorMessage: null,
        },
      ],
    };
    const agent = {
      generate: jest.fn().mockResolvedValue({ object: messy, text: '' }),
    };
    const result = await runBrandDiscoveryResearchBrand(
      agent as never,
      baseRequest as never,
    );
    expect(result.ok).toBe(true);
    expect(agent.generate).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.output.researchStatus).toBe('COMPLETED');
      expect(result.output.identity.name.value).toBe('Demo');
    }
  });
});
