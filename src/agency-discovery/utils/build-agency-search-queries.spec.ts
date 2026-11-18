import { buildAgencySearchQueries } from './build-agency-search-queries';

describe('buildAgencySearchQueries (2C.2)', () => {
  it('builds niche + country grounded queries within budget', () => {
    const queries = buildAgencySearchQueries({
      niche: 'beauty',
      country: 'US',
      markets: ['USA'],
      ibpTargetSectors: ['cosmetics'],
      maxSerpQueries: 4,
    });
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.length).toBeLessThanOrEqual(4);
    expect(queries.some((q) => /beauty/i.test(q))).toBe(true);
    expect(queries.some((q) => /US|USA/i.test(q))).toBe(true);
    expect(queries.every((q) => /influencer|creator/i.test(q))).toBe(true);
  });

  it('does not invent country when missing', () => {
    const queries = buildAgencySearchQueries({
      niches: ['fitness'],
      maxSerpQueries: 3,
    });
    expect(queries.length).toBeLessThanOrEqual(3);
    expect(queries.join(' ')).not.toMatch(/\bUS\b|\bUSA\b|\bSpain\b/i);
    expect(queries.some((q) => /fitness/i.test(q))).toBe(true);
  });

  it('dedupes near-identical query strings', () => {
    const queries = buildAgencySearchQueries({
      niche: 'food',
      country: 'MX',
      maxSerpQueries: 4,
    });
    const keys = queries.map((q) => q.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('respects maxSerpQueries cap', () => {
    expect(
      buildAgencySearchQueries({
        niche: 'travel',
        subNiche: 'luxury',
        country: 'US',
        markets: ['LATAM', 'USA'],
        ibpTargetSectors: ['hospitality'],
        maxSerpQueries: 2,
      }),
    ).toHaveLength(2);
  });
});
