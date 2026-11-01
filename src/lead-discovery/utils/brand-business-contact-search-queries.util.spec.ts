import { buildBrandBusinessContactSearchQueries } from './brand-business-contact-search-queries.util';

describe('buildBrandBusinessContactSearchQueries', () => {
  it('includes partnerships / influencer / affiliate / press email intent', () => {
    const queries = buildBrandBusinessContactSearchQueries({
      brandName: 'Liquid I.V.',
      domain: 'liquid-iv.com',
    });

    expect(queries.some((q) => q.includes('site:liquid-iv.com'))).toBe(true);
    expect(queries.some((q) => /partnerships/i.test(q))).toBe(true);
    expect(queries.some((q) => /influencer marketing/i.test(q))).toBe(true);
    expect(queries.some((q) => /affiliate/i.test(q))).toBe(true);
    expect(queries.some((q) => /press/i.test(q))).toBe(true);
    expect(queries.every((q) => /email|contact|@/i.test(q))).toBe(true);
  });

  it('returns empty when brand and domain are blank', () => {
    expect(
      buildBrandBusinessContactSearchQueries({ brandName: '', domain: '' }),
    ).toEqual([]);
  });
});
