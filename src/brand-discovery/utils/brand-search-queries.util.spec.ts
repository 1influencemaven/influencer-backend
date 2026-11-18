import {
  areNearDuplicateCategoryQueries,
  categorySignature,
  enforceCollaborationModeQueryQuota,
  isCollaborationModeLedQuery,
  isSectorGenericQuery,
  validateBrandSearchQueries,
  validateBrandSearchQueriesWithDiagnostics,
} from './brand-search-queries.util';

describe('validateBrandSearchQueries', () => {
  it('trims and drops empty / short / long strings', () => {
    expect(
      validateBrandSearchQueries([
        '  ',
        'short',
        'valid skincare product brands Colombia creator partnerships',
        'x'.repeat(201),
      ]),
    ).toEqual([
      'valid skincare product brands Colombia creator partnerships',
    ]);
  });

  it('dedupes case-insensitively', () => {
    expect(
      validateBrandSearchQueries([
        'Skincare product brands Colombia affiliate program',
        'skincare product brands colombia affiliate program',
      ]),
    ).toEqual(['Skincare product brands Colombia affiliate program']);
  });

  it('respects maxQueries (default cap 4)', () => {
    const queries = [
      'maternity apparel brands LATAM',
      'breastfeeding product brands United States',
      'baby care product companies LATAM',
      'postpartum wellness services United States',
      'prenatal vitamin brands LATAM',
    ];
    expect(validateBrandSearchQueries(queries)).toHaveLength(4);
    expect(validateBrandSearchQueries(queries, { maxQueries: 2 })).toHaveLength(
      2,
    );
  });

  it('drops listicle / ranking bait phrases', () => {
    expect(
      validateBrandSearchQueries([
        'best brands in beauty Colombia',
        'skincare product brands Colombia creator partnerships',
      ]),
    ).toEqual(['skincare product brands Colombia creator partnerships']);
  });

  it('drops queries containing excluded sectors', () => {
    expect(
      validateBrandSearchQueries(
        [
          'gambling casino brands Colombia influencer partnerships',
          'skincare product brands Colombia affiliate program',
        ],
        { excludedSectors: ['gambling'] },
      ),
    ).toEqual(['skincare product brands Colombia affiliate program']);
  });

  it('drops mode-led and sector-generic Diana queries', () => {
    expect(
      validateBrandSearchQueries([
        'LATAM entrepreneurship brands UGC opportunities',
        'personal development startups brand ambassador programs',
        'maternity SMB UGC partnerships LATAM',
        'United States personal development DTC brands',
      ]),
    ).toEqual([]);
  });

  it('keeps distinct concrete category queries', () => {
    const kept = validateBrandSearchQueries([
      'maternity apparel DTC brands United States',
      'breastfeeding product brands LATAM',
      'entrepreneurship education course brands LATAM',
      'mindset coaching services United States',
    ]);
    expect(kept).toHaveLength(4);
    expect(new Set(kept.map(categorySignature)).size).toBe(4);
  });

  it('drops near-duplicate category variants', () => {
    const { queries, diagnostics } = validateBrandSearchQueriesWithDiagnostics([
      'maternity apparel brands United States',
      'United States maternity apparel brands',
      'maternity apparel companies United States',
      'baby care product companies LATAM',
    ]);
    expect(queries).toEqual([
      'maternity apparel brands United States',
      'baby care product companies LATAM',
    ]);
    expect(
      diagnostics.discarded.some((d) => d.reason === 'near_duplicate_category'),
    ).toBe(true);
  });

  it('keeps a rare but legitimate commercial category', () => {
    expect(
      validateBrandSearchQueries([
        'mycelium packaging product brands LATAM',
        'compostable food container companies United States',
      ]),
    ).toEqual([
      'mycelium packaging product brands LATAM',
      'compostable food container companies United States',
    ]);
  });
});

describe('isSectorGenericQuery', () => {
  it('flags sector+market-only queries from the Diana post-quality run', () => {
    expect(isSectorGenericQuery('entrepreneurship brands LATAM')).toBe(true);
    expect(isSectorGenericQuery('maternity products United States')).toBe(true);
    expect(
      isSectorGenericQuery('personal development companies LATAM'),
    ).toBe(true);
    expect(
      isSectorGenericQuery('smb startups entrepreneurship United States'),
    ).toBe(true);
  });

  it('allows concrete product/service categories', () => {
    expect(
      isSectorGenericQuery('maternity apparel DTC brands United States'),
    ).toBe(false);
    expect(
      isSectorGenericQuery('breastfeeding product brands United States'),
    ).toBe(false);
    expect(
      isSectorGenericQuery('entrepreneurship education course brands LATAM'),
    ).toBe(false);
  });
});

describe('areNearDuplicateCategoryQueries', () => {
  it('detects word-order and synonym churn for the same category', () => {
    expect(
      areNearDuplicateCategoryQueries(
        'maternity apparel brands United States',
        'United States maternity apparel brands',
      ),
    ).toBe(true);
    expect(
      areNearDuplicateCategoryQueries(
        'maternity apparel brands United States',
        'baby care product companies LATAM',
      ),
    ).toBe(false);
  });
});

describe('isCollaborationModeLedQuery', () => {
  it('detects mode-only queries from the previous Diana run', () => {
    expect(
      isCollaborationModeLedQuery(
        'personal development startups brand ambassador programs',
      ),
    ).toBe(true);
    expect(
      isCollaborationModeLedQuery('maternity SMB UGC partnerships LATAM'),
    ).toBe(true);
    expect(
      isCollaborationModeLedQuery(
        'United States personal development DTC brands',
      ),
    ).toBe(false);
  });
});

describe('enforceCollaborationModeQueryQuota', () => {
  it('keeps product queries and one optional mode-modified query', () => {
    expect(
      enforceCollaborationModeQueryQuota([
        'maternity clothing brands LATAM',
        'baby products brands United States',
        'entrepreneurship education services LATAM UGC',
        'personal development DTC brands United States ambassador',
      ]).kept,
    ).toEqual([
      'maternity clothing brands LATAM',
      'baby products brands United States',
      'entrepreneurship education services LATAM UGC',
    ]);
  });
});
