import { buildBrandDiscoveryQueries } from './generate-brand-discovery.prompt';
import {
  categorySignature,
  isSectorGenericQuery,
  validateBrandSearchQueries,
} from '../../brand-discovery/utils/brand-search-queries.util';

describe('buildBrandDiscoveryQueries (PLAN fallback templates)', () => {
  it('expands maternity IBP into distinct concrete categories × markets', () => {
    const queries = validateBrandSearchQueries(
      buildBrandDiscoveryQueries(
        {
          targetSectors: ['maternity'],
          excludedSectors: ['alcohol'],
          brandSize: ['smb'],
          markets: ['United States', 'LATAM'],
          collaborationTypes: [],
          summary: 'Mom audience',
          alertSignals: [],
          desirableCriteria: ['Hashtags related to maternity'],
        },
        'Test',
        'maternidad',
      ),
      { maxQueries: 4, excludedSectors: ['alcohol'] },
    );

    expect(queries.length).toBeGreaterThanOrEqual(2);
    for (const q of queries) {
      expect(isSectorGenericQuery(q)).toBe(false);
      expect(q.toLowerCase()).toMatch(
        /apparel|breastfeeding|baby|postpartum/,
      );
    }
    expect(new Set(queries.map(categorySignature)).size).toBe(
      queries.length,
    );
  });

  it('expands entrepreneurship IBP beyond bare sector brands', () => {
    const queries = validateBrandSearchQueries(
      buildBrandDiscoveryQueries(
        {
          targetSectors: ['entrepreneurship'],
          excludedSectors: [],
          brandSize: ['startup'],
          markets: ['LATAM'],
          collaborationTypes: ['UGC'],
          summary: 'Latina founders',
          alertSignals: [],
          desirableCriteria: [],
        },
        'Test',
        null,
        { niches: ['Mama emprendedora', 'CEO'] },
      ),
      { maxQueries: 4 },
    );

    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.some((q) => /education|coaching|solopreneur/i.test(q))).toBe(
      true,
    );
    expect(queries.every((q) => !isSectorGenericQuery(q))).toBe(true);
  });

  it('expands personal development IBP into courses/coaching categories', () => {
    const queries = validateBrandSearchQueries(
      buildBrandDiscoveryQueries(
        {
          targetSectors: ['personal_development'],
          excludedSectors: [],
          brandSize: [],
          markets: ['United States'],
          collaborationTypes: [],
          summary: 'Mindset content',
          alertSignals: [],
          desirableCriteria: [
            'Hashtags related to personal development and entrepreneurship',
          ],
        },
        'Test',
        null,
        { niches: ['mindset latina'] },
      ),
      { maxQueries: 4 },
    );

    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(
      queries.some((q) => /course|coaching|journaling/i.test(q)),
    ).toBe(true);
  });

  it('supports multi-market templates without collapsing to one category', () => {
    const queries = validateBrandSearchQueries(
      buildBrandDiscoveryQueries(
        {
          targetSectors: ['maternity', 'entrepreneurship'],
          excludedSectors: [],
          brandSize: ['smb'],
          markets: ['LATAM', 'United States'],
          collaborationTypes: [],
          summary: 'Mom entrepreneur',
          alertSignals: [],
          desirableCriteria: [],
        },
        'Diana',
        null,
      ),
      { maxQueries: 4 },
    );

    const marketsHit = {
      latam: queries.some((q) => /latam/i.test(q)),
      us: queries.some((q) => /united states/i.test(q)),
    };
    expect(marketsHit.latam || marketsHit.us).toBe(true);
    expect(new Set(queries.map(categorySignature)).size).toBe(
      queries.length,
    );
  });
});
