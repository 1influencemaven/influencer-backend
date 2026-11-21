import { filterBrandDiscoverySearchHitsWithDiagnostics } from './brand-serp-hit-filter.util';

function hit(url: string, title = url) {
  return { title, url, content: '' };
}

describe('brand SERP hit filter — marketplaces, publishers and civic hosts', () => {
  it('drops pure marketplaces but keeps brand-owned retailers', () => {
    const result = filterBrandDiscoverySearchHitsWithDiagnostics([
      hit('https://www.amazon.com/skincare'),
      hit('https://www.etsy.com/market/candles'),
      hit('https://www.sephora.com/shop/skincare'),
      hit('https://glossier.com/'),
    ]);
    expect(result.diagnostics.keptDomains.sort()).toEqual([
      'glossier.com',
      'sephora.com',
    ]);
    expect(result.diagnostics.noiseHostCount).toBe(2);
  });

  it('drops news / editorial publishers and their subdomains', () => {
    const result = filterBrandDiscoverySearchHitsWithDiagnostics([
      hit('https://apnews.com/article/x'),
      hit('https://www.forbes.com/sites/y'),
      hit('https://shopping.allure.com/best'),
      hit('https://summersfridays.com/'),
    ]);
    expect(result.diagnostics.keptDomains).toEqual(['summersfridays.com']);
  });

  it('drops government / education hosts regardless of country suffix', () => {
    const result = filterBrandDiscoverySearchHitsWithDiagnostics([
      hit('https://www.ca.gov/programs'),
      hit('https://news.harvard.edu/x'),
      hit('https://www.gov.uk/brands'),
      hit('https://drinkolipop.com/'),
    ]);
    expect(result.diagnostics.keptDomains).toEqual(['drinkolipop.com']);
  });

  it('does not block ordinary .org / .com brand sites', () => {
    const result = filterBrandDiscoverySearchHitsWithDiagnostics([
      hit('https://brooklinen.com/'),
      hit('https://example-brand.org/'),
    ]);
    expect(result.diagnostics.keptDomains.sort()).toEqual([
      'brooklinen.com',
      'example-brand.org',
    ]);
  });

  it('still falls back to raw hits when everything is filtered', () => {
    const result = filterBrandDiscoverySearchHitsWithDiagnostics([
      hit('https://www.amazon.com/a'),
      hit('https://apnews.com/b'),
    ]);
    expect(result.diagnostics.fallbackToRaw).toBe(true);
    expect(result.hits).toHaveLength(2);
  });
});
