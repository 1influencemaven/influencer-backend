import {
  normalizeDomain,
  ensureWebsiteUrl,
  dedupeByDomain,
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
});
