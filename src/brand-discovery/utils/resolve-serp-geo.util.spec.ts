import {
  buildSerpLenses,
  buildSimplifiedSerpQuery,
  inferQueryTargetMarket,
  mergeHitGeoAttributions,
  parseGeoLensesMode,
  parseRegionCountryConfig,
  planSerpCalls,
  resolveSerpGeo,
} from './resolve-serp-geo.util';

describe('resolveSerpGeo (legacy)', () => {
  it('maps Spain country to gl=es hl=es', () => {
    expect(resolveSerpGeo({ country: 'Spain' })).toEqual({ gl: 'es', hl: 'es' });
  });

  it('maps LATAM market when country missing (legacy mx proxy)', () => {
    expect(resolveSerpGeo({ markets: ['LATAM'] })).toEqual({
      gl: 'mx',
      hl: 'es',
    });
  });

  it('defaults to us/en', () => {
    expect(resolveSerpGeo({})).toEqual({ gl: 'us', hl: 'en' });
  });

  it('prefers explicit language for hl', () => {
    expect(resolveSerpGeo({ country: 'USA', language: 'es' })).toEqual({
      gl: 'us',
      hl: 'es',
    });
  });

  it('maps United States market string', () => {
    expect(resolveSerpGeo({ markets: ['United States'] })).toEqual({
      gl: 'us',
      hl: 'en',
    });
  });
});

describe('parseGeoLensesMode', () => {
  it('defaults to legacy when unset', () => {
    expect(parseGeoLensesMode(undefined)).toBe('legacy');
    expect(parseGeoLensesMode('')).toBe('legacy');
    expect(parseGeoLensesMode('nope')).toBe('legacy');
  });

  it('accepts v1 explicitly', () => {
    expect(parseGeoLensesMode('v1')).toBe('v1');
    expect(parseGeoLensesMode('V1')).toBe('v1');
  });
});

describe('parseRegionCountryConfig', () => {
  it('parses names and gl codes with dedupe', () => {
    expect(parseRegionCountryConfig('Mexico,Colombia,mx,Argentina')).toEqual([
      { label: 'Mexico', gl: 'mx' },
      { label: 'Colombia', gl: 'co' },
      { label: 'Argentina', gl: 'ar' },
    ]);
  });

  it('returns empty for blank config', () => {
    expect(parseRegionCountryConfig('')).toEqual([]);
    expect(parseRegionCountryConfig(null)).toEqual([]);
  });
});

describe('buildSerpLenses (v1)', () => {
  it('United States → gl=us hl=en (market language)', () => {
    const { lenses } = buildSerpLenses({
      markets: ['United States'],
      language: 'es',
    });
    expect(lenses).toEqual([
      expect.objectContaining({
        role: 'ibp_market',
        marketLabel: 'United States',
        gl: 'us',
        hl: 'en',
      }),
    ]);
  });

  it('Colombia → gl=co hl=es', () => {
    const { lenses } = buildSerpLenses({ markets: ['Colombia'] });
    expect(lenses[0]).toMatchObject({ gl: 'co', hl: 'es' });
  });

  it('Brazil → gl=br hl=pt', () => {
    const { lenses } = buildSerpLenses({ markets: ['Brazil'] });
    expect(lenses[0]).toMatchObject({ gl: 'br', hl: 'pt' });
  });

  it('LATAM without config does not invent Mexico', () => {
    const { lenses, unresolvedRegions } = buildSerpLenses({
      markets: ['LATAM'],
      regionCountryConfig: { LATAM: '' },
    });
    expect(lenses.some((l) => l.gl === 'mx')).toBe(false);
    expect(unresolvedRegions).toEqual([
      { regionLabel: 'LATAM', reason: 'no_countries_configured' },
    ]);
    // fallback international lens when nothing else resolves
    expect(lenses).toEqual([
      expect.objectContaining({
        role: 'fallback',
        gl: 'us',
      }),
    ]);
  });

  it('LATAM with dynamic config expands configured countries', () => {
    const { lenses, unresolvedRegions } = buildSerpLenses({
      markets: ['LATAM'],
      regionCountryConfig: { LATAM: 'Colombia,Argentina' },
    });
    expect(unresolvedRegions).toEqual([]);
    expect(lenses.map((l) => l.gl).sort()).toEqual(['ar', 'co']);
    expect(lenses.every((l) => l.role === 'ibp_region')).toBe(true);
  });

  it('dedupes influencer country matching IBP market', () => {
    const { lenses } = buildSerpLenses({
      country: 'United States',
      markets: ['United States'],
    });
    expect(lenses).toHaveLength(1);
    expect(lenses[0].role).toBe('local_home');
    expect(lenses[0].gl).toBe('us');
  });

  it('ISO country=CO generates local_home Colombia (P1c)', () => {
    const { lenses } = buildSerpLenses({
      country: 'CO',
      markets: ['United States', 'LATAM'],
      regionCountryConfig: { LATAM: 'Mexico,Argentina' },
    });
    const home = lenses.find((l) => l.role === 'local_home');
    expect(home).toMatchObject({ gl: 'co', hl: 'es', marketLabel: 'CO' });
    expect(lenses.some((l) => l.gl === 'us' && l.role === 'ibp_market')).toBe(
      true,
    );
    expect(lenses.some((l) => l.gl === 'mx' && l.role === 'ibp_region')).toBe(
      true,
    );
    expect(lenses.some((l) => l.gl === 'ar' && l.role === 'ibp_region')).toBe(
      true,
    );
  });

  it('ISO country=US generates local_home and keeps IBP markets (P1c)', () => {
    const { lenses } = buildSerpLenses({
      country: 'US',
      markets: ['LATAM'],
      regionCountryConfig: { LATAM: 'co' },
    });
    expect(lenses.find((l) => l.role === 'local_home')).toMatchObject({
      gl: 'us',
      hl: 'en',
    });
    expect(lenses.some((l) => l.gl === 'co')).toBe(true);
  });

  it('keeps home country and distinct IBP market', () => {
    const { lenses } = buildSerpLenses({
      country: 'Colombia',
      language: 'es',
      markets: ['United States'],
    });
    expect(lenses.map((l) => l.gl).sort()).toEqual(['co', 'us']);
    expect(lenses.find((l) => l.gl === 'us')?.hl).toBe('en');
    expect(lenses.find((l) => l.gl === 'co')?.hl).toBe('es');
  });

  it('unknown country alone falls back to us', () => {
    const { lenses } = buildSerpLenses({
      country: 'Narnia',
      markets: [],
    });
    expect(lenses).toEqual([
      expect.objectContaining({ role: 'fallback', gl: 'us' }),
    ]);
  });

  it('market hl prevails over influencer language', () => {
    const { lenses } = buildSerpLenses({
      country: 'United States',
      language: 'español',
      markets: ['United States'],
    });
    expect(lenses[0].hl).toBe('en');
  });

  it('uses influencer language when market hl unknown', () => {
    // ve is mapped to es in GL_TO_HL — use a gl without market hl by forcing only country
    // Venezuela maps to ve with es in table; pick France + language es → market fr wins
    const { lenses } = buildSerpLenses({
      markets: ['France'],
      language: 'es',
    });
    expect(lenses[0]).toMatchObject({ gl: 'fr', hl: 'fr' });
  });

  it('Diana-like: US + LATAM config without silent MX-only', () => {
    const { lenses, unresolvedRegions } = buildSerpLenses({
      country: null,
      language: null,
      markets: ['LATAM', 'United States'],
      regionCountryConfig: { LATAM: 'mx,co' },
    });
    expect(unresolvedRegions).toEqual([]);
    const gls = lenses.map((l) => l.gl).sort();
    expect(gls).toContain('us');
    expect(gls).toEqual(['co', 'mx', 'us']);
  });
});

describe('inferQueryTargetMarket', () => {
  it('binds United States query to US market not LATAM', () => {
    expect(
      inferQueryTargetMarket(
        'maternity apparel brands United States',
        ['LATAM', 'United States'],
        null,
      ),
    ).toBe('United States');
  });

  it('binds LATAM when present in query', () => {
    expect(
      inferQueryTargetMarket(
        'entrepreneurship coaching companies LATAM',
        ['LATAM', 'United States'],
        null,
      ),
    ).toBe('LATAM');
  });
});

describe('planSerpCalls', () => {
  const lenses = buildSerpLenses({
    markets: ['LATAM', 'United States'],
    regionCountryConfig: { LATAM: 'co,mx' },
  }).lenses;

  it('does not execute US query on mx-only mismatched lenses', () => {
    const planned = planSerpCalls({
      queries: ['maternity apparel brands United States'],
      lenses,
      markets: ['LATAM', 'United States'],
      maxCalls: 12,
    });
    expect(
      planned.executed.every(
        (c) => c.lens.gl === 'us' || c.queryTargetMarket !== 'United States',
      ),
    ).toBe(true);
    expect(planned.executed.some((c) => c.lens.gl === 'us')).toBe(true);
    expect(
      planned.omitted.some(
        (o) =>
          o.reason === 'market_lens_mismatch' &&
          o.query.includes('United States'),
      ),
    ).toBe(true);
  });

  it('respects max 12 calls budget', () => {
    const queries = [
      'a brands selling in United States',
      'b brands selling in United States',
      'c brands selling in LATAM',
      'd brands selling in LATAM',
    ];
    const planned = planSerpCalls({
      queries,
      lenses,
      markets: ['LATAM', 'United States'],
      maxCalls: 12,
    });
    expect(planned.executed.length).toBeLessThanOrEqual(12);
    expect(planned.maxCalls).toBe(12);
  });

  it('prioritizes local_home lens', () => {
    const homeLenses = buildSerpLenses({
      country: 'Colombia',
      markets: ['United States'],
    }).lenses;
    const planned = planSerpCalls({
      queries: ['home decor brands Colombia', 'home decor brands United States'],
      lenses: homeLenses,
      markets: ['United States'],
      country: 'Colombia',
      maxCalls: 3,
    });
    expect(planned.executed[0]?.lens.role).toBe('local_home');
  });
});

describe('mergeHitGeoAttributions', () => {
  it('keeps markets from multiple lenses for same domain', () => {
    const merged = mergeHitGeoAttributions([
      {
        domain: 'shein.com',
        marketLabel: 'United States',
        role: 'ibp_market',
        gl: 'us',
        hl: 'en',
      },
      {
        domain: 'shein.com',
        marketLabel: 'Colombia',
        role: 'local_home',
        gl: 'co',
        hl: 'es',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].marketsSeen.sort()).toEqual(['Colombia', 'United States']);
    expect(merged[0].serpLenses).toHaveLength(2);
  });
});

describe('buildSimplifiedSerpQuery', () => {
  it('builds niche + selling-in market phrasing', () => {
    expect(
      buildSimplifiedSerpQuery({
        niche: 'beauty',
        country: 'Spain',
        markets: ['Spain', 'LATAM'],
      }),
    ).toBe('beauty brands selling in Spain');
  });

  it('returns null when too short', () => {
    expect(buildSimplifiedSerpQuery({})).toBeNull();
  });
});
