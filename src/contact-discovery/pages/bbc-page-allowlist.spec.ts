import {
  BBC_V1_DEFAULT_MAX_PAGES,
  BBC_V1_FETCH_PATHS,
  BBC_V1_PRIMARY_PATHS,
  BBC_V1_SECONDARY_PATHS,
  buildBbcV1PageUrls,
  normalizeBbcPageUrl,
  normalizeWebsiteBase,
} from './bbc-page-allowlist';

describe('bbc-page-allowlist (GAP-042)', () => {
  it('keeps primary list small enough that secondary is reachable under default maxPages', () => {
    expect(BBC_V1_PRIMARY_PATHS.length).toBeLessThan(BBC_V1_DEFAULT_MAX_PAGES);
    expect(BBC_V1_FETCH_PATHS.length).toBeLessThanOrEqual(
      BBC_V1_DEFAULT_MAX_PAGES,
    );
    expect(BBC_V1_PRIMARY_PATHS.length + BBC_V1_SECONDARY_PATHS.length).toBe(
      BBC_V1_FETCH_PATHS.length,
    );
  });

  it('avoids redundant singular/plural pairs', () => {
    const set = new Set(BBC_V1_FETCH_PATHS);
    expect(set.has('/affiliate') && set.has('/affiliates')).toBe(false);
    expect(set.has('/creator') && set.has('/creators')).toBe(false);
    expect(set.has('/influencer') && set.has('/influencers')).toBe(false);
    expect(set.has('/collaboration') && set.has('/collaborations')).toBe(
      false,
    );
  });

  it('builds primary then secondary URLs respecting maxPages', () => {
    const urls = buildBbcV1PageUrls('https://Brand.com', 8);
    expect(urls).toHaveLength(8);
    expect(urls[0]).toBe('https://brand.com/partnerships');
    expect(urls).toContain('https://brand.com/contact');
    expect(urls).not.toContain('https://brand.com/');
  });

  it('includes homepage only when maxPages covers the full list', () => {
    const urls = buildBbcV1PageUrls('https://brand.com', 12);
    expect(urls[urls.length - 1]).toBe('https://brand.com');
    expect(urls).toContain('https://brand.com/about');
  });

  it('returns empty for invalid website or non-positive maxPages', () => {
    expect(buildBbcV1PageUrls('', 10)).toEqual([]);
    expect(buildBbcV1PageUrls('https://brand.com', 0)).toEqual([]);
  });

  it('normalizes base and rejects cross-host pages', () => {
    expect(normalizeWebsiteBase('brand.com')).toBe('https://brand.com');
    expect(
      normalizeBbcPageUrl(
        'https://evil.com/contact',
        'https://brand.com',
      ),
    ).toBeNull();
  });
});
