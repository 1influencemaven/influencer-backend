import {
  isMultiBrandRetailer,
  parseRetailerPolicy,
  selectForPersistence,
} from './brand-retailer.util';

const c = (domain: string) => ({ domain });

describe('isMultiBrandRetailer', () => {
  it('matches department stores, big-box and beauty chains, with or without subdomains', () => {
    for (const d of [
      'sephora.com',
      'www.ulta.com',
      'shop.nordstrom.com',
      'macys.com',
      'target.com',
    ]) {
      expect(isMultiBrandRetailer(d)).toBe(true);
    }
  });

  it('does not match brand-owned stores or lookalike domains', () => {
    for (const d of [
      'glossier.com',
      'vuoriclothing.com',
      'us.dfyne.com',
      'notsephora.com',
      'sephora.com.evil.io',
      '',
    ]) {
      expect(isMultiBrandRetailer(d)).toBe(false);
    }
  });
});

describe('parseRetailerPolicy', () => {
  it('defaults to demote and accepts exclude/off', () => {
    expect(parseRetailerPolicy(undefined)).toBe('demote');
    expect(parseRetailerPolicy('nonsense')).toBe('demote');
    expect(parseRetailerPolicy(' EXCLUDE ')).toBe('exclude');
    expect(parseRetailerPolicy('off')).toBe('off');
  });
});

describe('selectForPersistence', () => {
  const ordered = [
    c('sephora.com'),
    c('ulta.com'),
    c('brand-a.com'),
    c('nordstrom.com'),
    c('brand-b.com'),
    c('brand-c.com'),
  ];

  it('demote: brands fill the limit first, retailers only the leftover slots', () => {
    const r = selectForPersistence(ordered, 4, 'demote');
    expect(r.selected.map((x) => x.domain)).toEqual([
      'brand-a.com',
      'brand-b.com',
      'brand-c.com',
      'sephora.com',
    ]);
    expect(r.retailersSelected.map((x) => x.domain)).toEqual(['sephora.com']);
    expect(r.cutByLimit.map((x) => x.domain)).toEqual([
      'ulta.com',
      'nordstrom.com',
    ]);
    expect(r.retailersExcluded).toHaveLength(0);
  });

  it('demote keeps retailers when there are not enough brands to fill the limit', () => {
    const r = selectForPersistence(ordered, 10, 'demote');
    expect(r.selected).toHaveLength(6);
    expect(r.cutByLimit).toHaveLength(0);
  });

  it('exclude: retailers never persist and are reported', () => {
    const r = selectForPersistence(ordered, 10, 'exclude');
    expect(r.selected.map((x) => x.domain)).toEqual([
      'brand-a.com',
      'brand-b.com',
      'brand-c.com',
    ]);
    expect(r.retailersExcluded.map((x) => x.domain)).toEqual([
      'sephora.com',
      'ulta.com',
      'nordstrom.com',
    ]);
  });

  it('off: keeps the incoming order and only applies the limit', () => {
    const r = selectForPersistence(ordered, 2, 'off');
    expect(r.selected.map((x) => x.domain)).toEqual(['sephora.com', 'ulta.com']);
    expect(r.cutByLimit).toHaveLength(4);
  });

  it('a zero limit selects nothing', () => {
    const r = selectForPersistence(ordered, 0, 'demote');
    expect(r.selected).toHaveLength(0);
  });
});
