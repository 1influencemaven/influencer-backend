import {
  normalizeDomain,
  ensureWebsiteUrl,
  dedupeByDomain,
  excludeExistingDomains,
} from './brand-domain.util';

describe('brand-domain.util', () => {
  it('normalizes domains', () => {
    expect(normalizeDomain('https://www.Example.com/path')).toBe('example.com');
    expect(normalizeDomain('example.com')).toBe('example.com');
  });

  it('ensures website urls', () => {
    expect(ensureWebsiteUrl('example.com')).toBe('https://example.com');
    expect(ensureWebsiteUrl('https://example.com')).toBe('https://example.com');
  });

  it('dedupes by domain', () => {
    const result = dedupeByDomain([
      { domain: 'a.com' },
      { domain: 'a.com' },
      { domain: 'b.com' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('excludes candidates whose domain already exists for the influencer', () => {
    const existing = new Set(['movavi.com', 'infinixmobility.com']);
    const result = excludeExistingDomains(
      [
        { domain: 'movavi.com', website: 'https://www.movavi.com' },
        { domain: 'senic.com', website: 'https://senic.com' },
        { domain: 'www.infinixmobility.com', website: 'https://infinixmobility.com' },
      ],
      existing,
    );

    expect(result).toEqual([
      { domain: 'senic.com', website: 'https://senic.com' },
    ]);
  });

  it('normalizes www and protocol when matching existing domains', () => {
    const existing = new Set(['movavi.com']);
    const result = excludeExistingDomains(
      [
        {
          domain: '',
          website: 'https://www.Movavi.com/products',
        },
        { domain: 'senic.com', website: 'https://senic.com' },
      ],
      existing,
    );

    expect(result.map((c) => c.domain || normalizeDomain(c.website!))).toEqual([
      'senic.com',
    ]);
  });

  it('drops candidates without domain or website', () => {
    const result = excludeExistingDomains(
      [{ domain: '', website: '' }, { domain: 'ok.com', website: 'https://ok.com' }],
      new Set(),
    );
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe('ok.com');
  });
});
