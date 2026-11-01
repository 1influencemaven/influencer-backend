import {
  BRAND_BUSINESS_CONTACT_PATHS,
  BRAND_BUSINESS_CONTACT_SECONDARY_PATHS,
  buildBrandBusinessContactPageUrls,
  normalizeBrandBusinessContactPageUrl,
} from './brand-business-contact-page-urls.util';

describe('brand-business-contact-page-urls', () => {
  it('builds URLs in commercial priority order (primary then secondary)', () => {
    const urls = buildBrandBusinessContactPageUrls('https://Brand.com', 12);
    expect(urls[0]).toBe('https://brand.com/partnerships');
    expect(urls).toHaveLength(12);
    expect(urls.map((u) => new URL(u).pathname)).toEqual([
      ...BRAND_BUSINESS_CONTACT_PATHS,
    ]);
  });

  it('respects max pages cap', () => {
    const urls = buildBrandBusinessContactPageUrls('https://brand.com', 3);
    expect(urls).toEqual([
      'https://brand.com/partnerships',
      'https://brand.com/affiliate',
      'https://brand.com/affiliates',
    ]);
  });

  it('includes secondary commercial paths when maxPages allows', () => {
    const urls = buildBrandBusinessContactPageUrls('https://brand.com', 20);
    expect(urls).toContain('https://brand.com/press');
    expect(urls).toContain('https://brand.com/about');
    expect(urls).toContain('https://brand.com/contact-us');
    expect(urls.some((u) => new URL(u).pathname === '/')).toBe(true);
    expect(urls.length).toBe(
      BRAND_BUSINESS_CONTACT_PATHS.length +
        BRAND_BUSINESS_CONTACT_SECONDARY_PATHS.length,
    );
  });

  it('strips query and hash and rejects other hosts', () => {
    const base = 'https://brand.com';
    expect(
      normalizeBrandBusinessContactPageUrl(
        'https://brand.com/partnerships?utm=1#x',
        base,
      ),
    ).toBe('https://brand.com/partnerships');
    expect(
      normalizeBrandBusinessContactPageUrl(
        'https://evil.com/partnerships',
        base,
      ),
    ).toBeNull();
  });

  it('returns empty for invalid website', () => {
    expect(buildBrandBusinessContactPageUrls('', 12)).toEqual([]);
    expect(
      buildBrandBusinessContactPageUrls('https://linkedin.com/company/x', 12),
    ).toEqual([]);
  });
});
