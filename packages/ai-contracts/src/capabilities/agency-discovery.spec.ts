import {
  agencyDiscoveryInputSchema,
  agencyDiscoveryOutputSchema,
  agencyIdentitySchema,
  agencyRelevanceStatusSchema,
  agencySearchMetadataSchema,
  agencyTypeSchema,
  influencerAgencyDiscoverySchema,
} from './agency-discovery';

describe('agency-discovery contracts (2C.1)', () => {
  it('accepts all AgencyType values', () => {
    for (const t of [
      'INFLUENCER_MARKETING_AGENCY',
      'TALENT_REPRESENTATION',
      'MARKETPLACE',
      'GENERAL_MARKETING',
      'DIRECTORY',
      'OTHER',
    ] as const) {
      expect(agencyTypeSchema.parse(t)).toBe(t);
    }
  });

  it('accepts all AgencyRelevanceStatus values', () => {
    for (const s of [
      'UNDER_REVIEW',
      'RELEVANT',
      'NOT_RELEVANT',
      'DISCARDED',
    ] as const) {
      expect(agencyRelevanceStatusSchema.parse(s)).toBe(s);
    }
  });

  it('parses agency identity with default OTHER type', () => {
    const parsed = agencyIdentitySchema.parse({
      name: 'Demo Influencer Agency',
      domain: 'demo-agency.com',
      website: 'https://demo-agency.com',
    });
    expect(parsed.agencyType).toBe('OTHER');
    expect(parsed.domain).toBe('demo-agency.com');
  });

  it('rejects empty agency name / domain', () => {
    expect(
      agencyIdentitySchema.safeParse({ name: '', domain: 'x.com' }).success,
    ).toBe(false);
    expect(
      agencyIdentitySchema.safeParse({ name: 'X', domain: '' }).success,
    ).toBe(false);
  });

  it('parses influencer–agency association with evidence', () => {
    const parsed = influencerAgencyDiscoverySchema.parse({
      relevanceStatus: 'UNDER_REVIEW',
      niches: ['beauty'],
      markets: ['USA'],
      evidenceUrls: ['https://demo-agency.com/brands'],
      evidence: [
        {
          url: 'https://demo-agency.com/brands',
          excerpt: 'We connect brands with creators',
        },
      ],
    });
    expect(parsed.niches).toEqual(['beauty']);
    expect(parsed.evidence).toHaveLength(1);
  });

  it('parses DISCOVER_AGENCIES input (future Mastra shape)', () => {
    const parsed = agencyDiscoveryInputSchema.parse({
      operation: 'DISCOVER_AGENCIES',
      influencerId: '11111111-1111-4111-8111-111111111111',
      influencerName: 'Ana Fit',
      niches: ['fitness'],
      country: 'US',
      markets: ['USA'],
      ibpTargetSectors: ['wellness'],
      maxSerpQueries: 4,
    });
    expect(parsed.operation).toBe('DISCOVER_AGENCIES');
    expect(parsed.maxSerpQueries).toBe(4);
  });

  it('rejects DISCOVER_AGENCIES input without influencerId', () => {
    expect(
      agencyDiscoveryInputSchema.safeParse({
        operation: 'DISCOVER_AGENCIES',
        influencerId: '',
        influencerName: 'Ana',
      }).success,
    ).toBe(false);
  });

  it('accepts non-uuid influencerId strings (Nest resource ids)', () => {
    expect(
      agencyDiscoveryInputSchema.safeParse({
        operation: 'DISCOVER_AGENCIES',
        influencerId: 'i1',
        influencerName: 'Ana',
      }).success,
    ).toBe(true);
  });

  it('parses discovery output with candidates and searchMetadata', () => {
    const parsed = agencyDiscoveryOutputSchema.parse({
      operation: 'DISCOVER_AGENCIES',
      outcome: 'RESULTS_FOUND',
      candidates: [
        {
          agency: {
            name: 'Demo Agency',
            domain: 'demo-agency.com',
            agencyType: 'INFLUENCER_MARKETING_AGENCY',
          },
          association: {
            relevanceStatus: 'UNDER_REVIEW',
            evidenceUrls: ['https://demo-agency.com/'],
          },
        },
      ],
      searchMetadata: {
        schemaVersion: 1,
        queries: ['influencer marketing agency fitness USA'],
        searchHitsCount: 6,
        classifiedCount: 1,
      },
    });
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.searchMetadata?.classifiedCount).toBe(1);
  });

  it('parses agencySearchMetadata schemaVersion 1', () => {
    expect(
      agencySearchMetadataSchema.parse({
        queries: ['q1'],
        searchHitsCount: 0,
      }).schemaVersion,
    ).toBe(1);
  });

  it('caps candidates at 50', () => {
    const candidate = {
      agency: { name: 'A', domain: 'a.com' },
      association: {},
    };
    const many = Array.from({ length: 51 }, (_, i) => ({
      ...candidate,
      agency: { name: `A${i}`, domain: `a${i}.com` },
    }));
    expect(
      agencyDiscoveryOutputSchema.safeParse({
        operation: 'DISCOVER_AGENCIES',
        outcome: 'NO_MATCHES',
        candidates: many,
      }).success,
    ).toBe(false);
  });
});
