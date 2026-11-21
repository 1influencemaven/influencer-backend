import { canonicalMarkets, isIbpCompatibleMarket } from './ibp-market.util';

const US = new Set(['us']);

describe('isIbpCompatibleMarket', () => {
  it.each([
    'US',
    'USA',
    'United States',
    'U.S.',
    'United States of America',
    'America',
    'North America',
    'New York, US',
    'Global',
    'Worldwide',
  ])('accepts %s for a US IBP', (market) => {
    expect(isIbpCompatibleMarket(market, US)).toBe(true);
  });

  it.each(['Canada', 'UK', 'Germany', 'Latin America'])(
    'rejects %s for a US IBP',
    (market) => {
      expect(isIbpCompatibleMarket(market, US)).toBe(false);
    },
  );

  it('treats an empty candidate market as compatible', () => {
    expect(isIbpCompatibleMarket('  ', US)).toBe(true);
  });

  it('matches spelled-out IBP markets against codes and vice versa', () => {
    expect(isIbpCompatibleMarket('US', new Set(['united states']))).toBe(true);
    expect(isIbpCompatibleMarket('Mexico', new Set(['mx', 'us']))).toBe(true);
    expect(isIbpCompatibleMarket('Colombia', new Set(['latam']))).toBe(false);
  });

  it('keeps the legacy substring behaviour for non-aliased markets', () => {
    expect(isIbpCompatibleMarket('Nordics', new Set(['nordics']))).toBe(true);
  });
});

describe('canonicalMarkets', () => {
  it('expands North America and splits compound values', () => {
    expect([...canonicalMarkets('North America')].sort()).toEqual([
      'ca',
      'mx',
      'us',
    ]);
    expect([...canonicalMarkets('US & Canada')].sort()).toEqual(['ca', 'us']);
  });
});
