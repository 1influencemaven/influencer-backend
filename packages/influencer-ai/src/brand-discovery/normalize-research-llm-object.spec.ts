import { brandDeepResearchOutputBodySchema } from '@influence-maven/ai-contracts';

import {
  coerceResearchAgentStatus,
  coerceResearchedField,
  normalizeResearchLlmObject,
} from './normalize-research-llm-object';

/** Real Mastra failure payload shape (Example Company / qwen2.5:7b). */
const EXAMPLE_COMPANY_INVALID = {
  researchStatus: 'VERIFIED',
  identity: {
    name: 'Example Company',
    officialWebsite: {
      value: 'https://www.examplecompany.com',
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com',
          excerpt: 'Welcome to Example Company',
          pageRole: 'homepage',
        },
      ],
      note: null,
    },
    domain: {
      value: 'examplecompany.com',
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com',
          excerpt: 'Welcome to Example Company',
          pageRole: 'homepage',
        },
      ],
      note: null,
    },
  },
  company: {
    description: {
      value: 'Example Company is a global leader in technology solutions.',
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com/about',
          excerpt: 'Example Company is a global leader in technology solutions.',
          pageRole: 'about',
        },
      ],
      note: null,
    },
    brandSize: {
      value: 'Large',
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com/about',
          excerpt: 'Example Company is a global leader in technology solutions.',
          pageRole: 'about',
        },
      ],
      note: null,
    },
  },
  industry: {
    sectors: {
      value: ['Technology', 'Software'],
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com/about',
          excerpt: 'Example Company is a global leader in technology solutions.',
          pageRole: 'about',
        },
      ],
      note: null,
    },
    categories: {
      value: ['Enterprise Software', 'Cloud Solutions'],
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com/products',
          excerpt: 'Enterprise Software and Cloud Solutions',
          pageRole: 'products',
        },
      ],
      note: null,
    },
  },
  offerings: {
    productsAndServices: {
      value: ['Enterprise Software', 'Cloud Solutions'],
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com/products',
          excerpt: 'Enterprise Software and Cloud Solutions',
          pageRole: 'products',
        },
      ],
      note: null,
    },
  },
  markets: {
    countriesOrRegions: {
      value: ['North America', 'Europe', 'Asia Pacific'],
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com/markets',
          excerpt: 'Our presence in North America, Europe, and Asia Pacific.',
          pageRole: 'about',
        },
      ],
      note: null,
    },
  },
  commercialSignals: [
    {
      kind: 'influencer_marketing',
      value: null,
      status: 'PARTIAL',
      evidence: [
        {
          url: 'https://www.examplecompany.com/partnerships',
          excerpt: 'Partnerships and Influencer Programs',
          pageRole: 'partnerships',
        },
      ],
      note: 'Influencer programs mentioned but no clear evidence of active programs.',
    },
  ],
  influencerFit: {
    score: 75,
    rationale: {
      value:
        'Company is established and recognized in the industry, has a diverse product line, and operates in multiple regions.',
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com/about',
          excerpt: 'Example Company is a global leader in technology solutions.',
          pageRole: 'about',
        },
      ],
      note: null,
    },
    alignmentNotes: {
      value: ['Industry alignment', 'Product diversification', 'Global reach'],
      status: 'VERIFIED',
      evidence: [
        {
          url: 'https://www.examplecompany.com/about',
          excerpt: 'Example Company is a global leader in technology solutions.',
          pageRole: 'about',
        },
      ],
      note: null,
    },
  },
  pages: [
    {
      url: 'https://www.examplecompany.com',
      role: 'homepage',
      fetchStatus: 'ok',
      httpStatus: 200,
      errorMessage: null,
    },
    {
      url: 'https://www.examplecompany.com/about',
      role: 'about',
      fetchStatus: 'ok',
      httpStatus: 200,
      errorMessage: null,
    },
    {
      url: 'https://www.examplecompany.com/products',
      role: 'products',
      fetchStatus: 'ok',
      httpStatus: 200,
      errorMessage: null,
    },
    {
      url: 'https://www.examplecompany.com/markets',
      role: 'about',
      fetchStatus: 'ok',
      httpStatus: 200,
      errorMessage: null,
    },
  ],
  warnings: [
    'No evidence found for influencer marketing or affiliate programs.',
  ],
};

describe('normalizeResearchLlmObject', () => {
  it('maps VERIFIED researchStatus to COMPLETED', () => {
    expect(coerceResearchAgentStatus('VERIFIED')).toBe('COMPLETED');
    expect(coerceResearchAgentStatus('partial')).toBe('PARTIAL');
  });

  it('wraps bare identity.name string into researched field', () => {
    expect(coerceResearchedField('HATCH Collection')).toEqual({
      value: 'HATCH Collection',
      status: 'VERIFIED',
      evidence: [],
    });
  });

  it('repairs the real Example Company Mastra failure payload', () => {
    const normalized = normalizeResearchLlmObject(EXAMPLE_COMPANY_INVALID);
    const parsed = brandDeepResearchOutputBodySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.researchStatus).toBe('COMPLETED');
    expect(parsed.data.identity.name).toEqual({
      value: 'Example Company',
      status: 'VERIFIED',
      evidence: [],
    });
    expect(parsed.data.identity.officialWebsite.note).toBeUndefined();
    expect(parsed.data.pages[0]?.errorMessage).toBeUndefined();
    expect(parsed.data.pages).toHaveLength(4);
  });

  it('fails strict parse without normalize on the same payload', () => {
    const raw = brandDeepResearchOutputBodySchema.safeParse(
      EXAMPLE_COMPANY_INVALID,
    );
    expect(raw.success).toBe(false);
  });
});
