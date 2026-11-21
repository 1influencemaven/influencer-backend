import {
  buildExpandedBrandQueries,
  marketLabel,
} from './brand-query-expansion.util';
import { expandSectorsToSubcategories } from './brand-sector-taxonomy.util';
import { validateBrandSearchQueriesWithDiagnostics } from './brand-search-queries.util';

describe('expandSectorsToSubcategories', () => {
  it('expands abstract sectors into concrete subcategories', () => {
    const subs = expandSectorsToSubcategories(['beauty']);
    expect(subs).toEqual(
      expect.arrayContaining(['skincare', 'makeup', 'haircare']),
    );
  });

  it('interleaves groups so every sector appears early', () => {
    const subs = expandSectorsToSubcategories(
      ['beauty', 'fashion', 'home decor'],
      6,
    );
    expect(subs).toHaveLength(6);
    // Round-robin: one of each group in the first three picks.
    expect(subs.slice(0, 3)).toEqual(['skincare', 'womens clothing', 'candles']);
  });

  it('understands Spanish sector names', () => {
    expect(expandSectorsToSubcategories(['belleza'])).toContain('skincare');
    expect(expandSectorsToSubcategories(['decoración del hogar'])).toContain(
      'candles',
    );
  });

  it('keeps a concrete unknown term and drops abstract-only ones', () => {
    expect(expandSectorsToSubcategories(['mycelium packaging'])).toEqual([
      'mycelium packaging',
    ]);
    expect(expandSectorsToSubcategories(['mindset', 'comedy'])).toEqual([]);
  });

  it('dedupes subcategories shared by several groups and honours max', () => {
    const subs = expandSectorsToSubcategories(['fitness', 'fashion'], 20);
    expect(new Set(subs).size).toBe(subs.length);
    expect(expandSectorsToSubcategories(['beauty', 'fashion'], 3)).toHaveLength(
      3,
    );
  });
});

describe('buildExpandedBrandQueries', () => {
  it('builds brand-site queries with the market label', () => {
    const queries = buildExpandedBrandQueries({
      sectors: ['beauty', 'fashion', 'home decor'],
      markets: ['US'],
      max: 6,
    });
    expect(queries).toHaveLength(6);
    expect(queries.every((q) => q.includes('United States'))).toBe(true);
    expect(queries[0]).toBe('skincare brand official site United States');
    expect(queries[1]).toBe('womens clothing brand creator program United States');
    expect(queries[2]).toBe('candles DTC brand ambassador program United States');
  });

  it('never leaks internal IBP enum tokens into queries', () => {
    const queries = buildExpandedBrandQueries({
      sectors: ['beauty'],
      markets: ['US'],
    });
    for (const q of queries) {
      expect(q).not.toMatch(/\bsmb\b|mid_market|startup/i);
    }
  });

  it('falls back to the influencer country, then United States', () => {
    expect(
      buildExpandedBrandQueries({ sectors: ['beauty'], country: 'MX', max: 1 })[0],
    ).toContain('Mexico');
    expect(
      buildExpandedBrandQueries({ sectors: ['beauty'], max: 1 })[0],
    ).toContain('United States');
  });

  it('returns nothing when no concrete subcategory can be derived', () => {
    expect(buildExpandedBrandQueries({ sectors: ['mindset'] })).toEqual([]);
  });

  it('survives the Nest query validator (diverse, not sector-generic)', () => {
    const queries = buildExpandedBrandQueries({
      sectors: ['beauty', 'fashion', 'home decor', 'lifestyle'],
      markets: ['US'],
      max: 8,
    });
    const validated = validateBrandSearchQueriesWithDiagnostics(queries, {
      maxQueries: 8,
      maxCollaborationModeQueries: 4,
    });
    expect(validated.queries.length).toBeGreaterThanOrEqual(7);
    expect(
      validated.diagnostics.discarded.filter(
        (d) => d.reason === 'sector_generic',
      ),
    ).toHaveLength(0);
  });
});

describe('marketLabel', () => {
  it('maps codes and passes through unknown values', () => {
    expect(marketLabel('US')).toBe('United States');
    expect(marketLabel('latam')).toBe('Latin America');
    expect(marketLabel('Narnia')).toBe('Narnia');
    expect(marketLabel('  ')).toBeNull();
    expect(marketLabel(null)).toBeNull();
  });
});
