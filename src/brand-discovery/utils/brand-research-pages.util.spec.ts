import {
  BRAND_RESEARCH_MAX_PAGES,
  buildBrandResearchPageCandidates,
  dedupeResearchUrls,
} from './brand-research-pages.util';

describe('brand-research-pages', () => {
  it('caps at 4 unique authorized URLs including homepage', () => {
    const pages = buildBrandResearchPageCandidates({
      website: 'https://demo.example',
      domain: 'demo.example',
    });
    expect(pages.length).toBeLessThanOrEqual(BRAND_RESEARCH_MAX_PAGES);
    expect(pages[0].role).toBe('homepage');
    const urls = new Set(pages.map((p) => p.url.replace(/\/$/, '').toLowerCase()));
    expect(urls.size).toBe(pages.length);
  });

  it('dedupes URLs', () => {
    expect(
      dedupeResearchUrls([
        'https://a.example/',
        'https://a.example',
        'https://b.example',
      ]),
    ).toEqual(['https://a.example/', 'https://b.example']);
  });
});
