import {
  buildPersonQueryLadder,
  DEFAULT_PERSON_PRIORITY_ROLES,
} from './person-query-ladder';

describe('buildPersonQueryLadder', () => {
  it('builds site:linkedin.com/in queries for brand + roles', () => {
    const queries = buildPersonQueryLadder({
      brandName: 'Liquid I.V.',
      priorityRoles: ['Partnerships'],
      maxQueries: 6,
    });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.length).toBeLessThanOrEqual(6);
    expect(queries.some((q) => q.includes('site:linkedin.com/in'))).toBe(true);
    expect(queries.some((q) => q.includes('Liquid I.V.'))).toBe(true);
  });

  it('returns empty when brand blank', () => {
    expect(buildPersonQueryLadder({ brandName: '   ' })).toEqual([]);
  });

  it('exposes default roles', () => {
    expect(DEFAULT_PERSON_PRIORITY_ROLES).toContain(
      'Influencer Marketing Manager',
    );
  });
});
