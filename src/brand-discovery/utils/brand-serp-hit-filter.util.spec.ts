import {
  filterBrandDiscoverySearchHits,
  filterBrandDiscoverySearchHitsWithDiagnostics,
  isSecondaryContentUrl,
} from './brand-serp-hit-filter.util';

describe('filterBrandDiscoverySearchHits', () => {
  it('drops social/wiki/directory noise and dedupes by domain', () => {
    const result = filterBrandDiscoverySearchHits([
      {
        title: 'Agency landing',
        url: 'https://awisee.com/es/influencer-marketing-spain/',
      },
      {
        title: 'Same brand deep page',
        url: 'https://awisee.com/blog/post',
      },
      {
        title: 'Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Influencer_marketing',
      },
      {
        title: 'LinkedIn',
        url: 'https://www.linkedin.com/company/based',
      },
      {
        title: 'Product brand',
        url: 'https://based.com/?srsltid=abc',
      },
    ]);

    expect(result.map((h) => h.url)).toEqual([
      'https://awisee.com/es/influencer-marketing-spain/',
      'https://based.com/?srsltid=abc',
    ]);
  });

  it('drops org-chart directories such as TheOrg as noise', () => {
    const result = filterBrandDiscoverySearchHits([
      {
        title: 'LATAM org',
        url: 'https://theorg.com/org/latam-airlines/teams/user-example',
      },
      {
        title: 'Pregnancy product brand',
        url: 'https://hatchcollection.com/',
      },
    ]);
    expect(result.map((h) => h.url)).toEqual(['https://hatchcollection.com/']);
  });

  it('drops scribd and listicle/how-to secondary content from the Diana run', () => {
    const { hits, diagnostics } = filterBrandDiscoverySearchHitsWithDiagnostics([
      {
        title: 'UGC LATAM',
        url: 'https://ofertasugc.com/en',
      },
      {
        title: 'How to create a brand ambassador program',
        url: 'https://impact.com/influencer/how-to-create-a-brand-ambassador-program/',
      },
      {
        title: 'Top DTC brands',
        url: 'https://www.mds.co/blog/top-dtc-brands',
      },
      {
        title: 'Scribd doc',
        url: 'https://www.scribd.com/document/123/dtc',
      },
      {
        title: 'Maternity brand homepage',
        url: 'https://hatchcollection.com/',
      },
    ]);

    expect(hits.map((h) => h.url)).toEqual([
      'https://ofertasugc.com/en',
      'https://hatchcollection.com/',
    ]);
    expect(diagnostics.secondaryContentCount).toBe(2);
    expect(diagnostics.noiseHostCount).toBe(1);
    expect(diagnostics.discarded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'impact.com',
          reason: 'secondary_content',
        }),
        expect.objectContaining({
          domain: 'mds.co',
          reason: 'secondary_content',
        }),
        expect.objectContaining({
          domain: 'scribd.com',
          reason: 'noise_host',
        }),
      ]),
    );
  });

  it('keeps original hits when everything is noise', () => {
    const hits = [
      { title: 'Wiki', url: 'https://en.wikipedia.org/wiki/X' },
      { title: 'YT', url: 'https://youtube.com/watch?v=1' },
    ];
    expect(filterBrandDiscoverySearchHits(hits)).toEqual(hits);
  });

  it('returns empty for empty input', () => {
    expect(filterBrandDiscoverySearchHits([])).toEqual([]);
  });
});

describe('isSecondaryContentUrl', () => {
  it('flags listicles and ambassador how-tos', () => {
    expect(isSecondaryContentUrl('https://mds.co/blog/top-dtc-brands')).toBe(
      true,
    );
    expect(
      isSecondaryContentUrl(
        'https://impact.com/influencer/how-to-create-a-brand-ambassador-program/',
      ),
    ).toBe(true);
    expect(isSecondaryContentUrl('https://hatchcollection.com/')).toBe(false);
    expect(isSecondaryContentUrl('https://hatchcollection.com/products')).toBe(
      false,
    );
  });

  it('flags vendor roundups and top-services/providers paths (STARHUNTER magazine)', () => {
    expect(
      isSecondaryContentUrl(
        'https://leadership-development-latin-america.managehrmagazine.com/vendors/top-leadership-development-services-pproviders-in-latin-america.html',
      ),
    ).toBe(true);
    expect(
      isSecondaryContentUrl(
        'https://example.com/vendors/top-leadership-development-services/',
      ),
    ).toBe(true);
    expect(
      isSecondaryContentUrl('https://example.com/top-cloud-providers-2024'),
    ).toBe(true);
    expect(isSecondaryContentUrl('https://micoachlatam.com/nosotros/')).toBe(
      false,
    );
  });
});

describe('VC / accelerator / magazine SERP noise', () => {
  it('drops 500.co, YC, F6S and editorial magazine hosts as noise', () => {
    const { hits, diagnostics } = filterBrandDiscoverySearchHitsWithDiagnostics([
      { title: '500', url: 'https://500.co/latam-companies' },
      { title: 'YC', url: 'https://www.ycombinator.com/companies' },
      { title: 'F6S', url: 'https://www.f6s.com/startups' },
      {
        title: 'Magazine vendors',
        url: 'https://leadership-development-latin-america.managehrmagazine.com/vendors/top-leadership-development-services-pproviders-in-latin-america.html',
      },
      { title: 'HATCH', url: 'https://hatchcollection.com/' },
      { title: 'Micoach', url: 'https://micoachlatam.com/nosotros/' },
    ]);

    expect(hits.map((h) => h.url)).toEqual([
      'https://hatchcollection.com/',
      'https://micoachlatam.com/nosotros/',
    ]);
    expect(diagnostics.noiseHostCount).toBe(4);
  });
});

describe('filterBrandDiscoverySearchHitsWithDiagnostics', () => {
  it('records received/kept/discarded reasons for noise and duplicates', () => {
    const { hits, diagnostics } = filterBrandDiscoverySearchHitsWithDiagnostics([
      {
        title: 'Agency',
        url: 'https://awisee.com/landing',
      },
      {
        title: 'Dup',
        url: 'https://awisee.com/other',
      },
      {
        title: 'TheOrg',
        url: 'https://theorg.com/org/latam-airlines/teams/x',
      },
      {
        title: 'Brand',
        url: 'https://based.com/',
      },
    ]);

    expect(hits.map((h) => h.url)).toEqual([
      'https://awisee.com/landing',
      'https://based.com/',
    ]);
    expect(diagnostics.receivedCount).toBe(4);
    expect(diagnostics.keptCount).toBe(2);
    expect(diagnostics.discardedCount).toBe(2);
    expect(diagnostics.duplicateDomainCount).toBe(1);
    expect(diagnostics.noiseHostCount).toBe(1);
    expect(diagnostics.secondaryContentCount).toBe(0);
    expect(diagnostics.fallbackToRaw).toBe(false);
    expect(diagnostics.keptDomains).toEqual(['awisee.com', 'based.com']);
  });

  it('marks fallbackToRaw when only noise remains', () => {
    const hits = [
      { title: 'Wiki', url: 'https://en.wikipedia.org/wiki/X' },
      { title: 'Org', url: 'https://theorg.com/org/x' },
    ];
    const result = filterBrandDiscoverySearchHitsWithDiagnostics(hits);
    expect(result.hits).toEqual(hits);
    expect(result.diagnostics.fallbackToRaw).toBe(true);
    expect(result.diagnostics.noiseHostCount).toBe(2);
    expect(result.diagnostics.keptCount).toBe(2);
  });
});
