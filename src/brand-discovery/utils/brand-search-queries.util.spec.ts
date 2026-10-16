import { validateBrandSearchQueries } from './brand-search-queries.util';

describe('validateBrandSearchQueries', () => {
  it('trims and drops empty / short / long strings', () => {
    expect(
      validateBrandSearchQueries([
        '  ',
        'short',
        'valid skincare influencer partnerships Colombia',
        'x'.repeat(201),
      ]),
    ).toEqual(['valid skincare influencer partnerships Colombia']);
  });

  it('dedupes case-insensitively', () => {
    expect(
      validateBrandSearchQueries([
        'Beauty brands Colombia affiliate program',
        'beauty brands colombia affiliate program',
      ]),
    ).toEqual(['Beauty brands Colombia affiliate program']);
  });

  it('respects maxQueries', () => {
    const queries = [
      'one sector market influencer partnerships aa',
      'two sector market affiliate ambassador bb',
      'three sector market emerging dtc brands cc',
      'four niche commercial collaboration brands',
      'five should be dropped because over max',
    ];
    expect(validateBrandSearchQueries(queries, { maxQueries: 4 })).toHaveLength(
      4,
    );
  });

  it('drops listicle / ranking bait phrases', () => {
    expect(
      validateBrandSearchQueries([
        'best brands in beauty Colombia',
        'beauty brands Colombia creator partnerships',
      ]),
    ).toEqual(['beauty brands Colombia creator partnerships']);
  });

  it('drops queries containing excluded sectors', () => {
    expect(
      validateBrandSearchQueries(
        [
          'gambling brands Colombia influencer partnerships',
          'skincare brands Colombia affiliate program',
        ],
        { excludedSectors: ['gambling'] },
      ),
    ).toEqual(['skincare brands Colombia affiliate program']);
  });
});
