import {
  assessBrandCommercialEligibility,
  filterBrandsByCommercialEligibility,
} from './brand-commercial-eligibility.util';

describe('assessBrandCommercialEligibility', () => {
  it('rejects ofertasugc.com as UGC marketplace, not advertiser brand', () => {
    const result = assessBrandCommercialEligibility({
      name: 'UGC LATAM',
      website: 'https://ofertasugc.com',
      sector: 'UGC',
      market: 'LATAM',
      score: 95,
      fitReason:
        'Latam-based UGC creator community with a strong focus on Latin American creators',
      evidenceUrls: ['https://ofertasugc.com/en'],
    });
    expect(result.commercialEligible).toBe(false);
    expect(result.entityType).toBe('marketplace');
  });

  it('rejects impact.com how-to ambassador article as partnership SaaS without product opportunity', () => {
    const result = assessBrandCommercialEligibility({
      name: 'Impact.com',
      website: 'https://impact.com',
      sector: 'Influencer Marketing',
      market: 'Global',
      score: 85,
      fitReason:
        'Offers detailed guidance on creating brand ambassador programs, which aligns with personal development',
      evidenceUrls: [
        'https://impact.com/influencer/how-to-create-a-brand-ambassador-program/',
      ],
    });
    expect(result.commercialEligible).toBe(false);
    expect(result.entityType).toBe('tech_platform');
  });

  it('rejects mds.co listicle publisher as DTC brand', () => {
    const result = assessBrandCommercialEligibility({
      name: 'MDs.co',
      website: 'https://mds.co',
      sector: 'DTC',
      market: 'Global',
      score: 80,
      fitReason:
        'Provides insights and case studies on successful DTC brands',
      evidenceUrls: ['https://www.mds.co/blog/top-dtc-brands'],
    });
    expect(result.commercialEligible).toBe(false);
    expect(result.entityType).toBe('publisher');
  });

  it('keeps a maternity product brand with corporate homepage evidence', () => {
    const result = assessBrandCommercialEligibility({
      name: 'Hatch Collection',
      website: 'https://hatchcollection.com',
      sector: 'maternity',
      market: 'United States',
      brandSize: 'smb',
      score: 82,
      fitReason:
        'Sells maternity clothing to mothers in the US; realistic ambassador or UGC collaboration for a Latina mom entrepreneur audience',
      evidenceUrls: ['https://hatchcollection.com/'],
    });
    expect(result.commercialEligible).toBe(true);
    expect(result.entityType).toBe('product_brand');
  });

  it('keeps entrepreneurship education service companies', () => {
    const result = assessBrandCommercialEligibility({
      name: 'Hotmart',
      website: 'https://hotmart.com',
      sector: 'entrepreneurship',
      market: 'LATAM',
      score: 78,
      fitReason:
        'LATAM digital products and education platform selling courses to entrepreneurs; audience overlap with mama emprendedora content',
      evidenceUrls: ['https://hotmart.com/'],
    });
    expect(result.commercialEligible).toBe(true);
  });

  it('rejects 500.co as venture capital, not an advertiser brand', () => {
    const result = assessBrandCommercialEligibility({
      name: '500.co',
      website: 'https://500.co',
      sector: 'tech startup',
      market: 'LATAM',
      score: 75,
      fitReason:
        'LatAm-focused tech startup portfolio backed by early-stage venture capital',
      evidenceUrls: ['https://500.co/latam-companies'],
    });
    expect(result.commercialEligible).toBe(false);
    expect(result.entityType).toBe('venture_capital');
  });

  it('rejects Y Combinator as accelerator', () => {
    const result = assessBrandCommercialEligibility({
      name: 'Y Combinator',
      website: 'https://www.ycombinator.com',
      sector: 'startups',
      market: 'United States',
      score: 70,
      fitReason: 'Startup accelerator with LATAM companies',
      evidenceUrls: ['https://www.ycombinator.com/companies'],
    });
    expect(result.commercialEligible).toBe(false);
    expect(result.entityType).toBe('accelerator');
  });

  it('rejects F6S as startup directory', () => {
    const result = assessBrandCommercialEligibility({
      name: 'F6S',
      website: 'https://www.f6s.com',
      sector: 'startups',
      market: 'Global',
      score: 60,
      fitReason: 'Startup directory and deals platform',
      evidenceUrls: ['https://www.f6s.com/startups'],
    });
    expect(result.commercialEligible).toBe(false);
    expect(result.entityType).toBe('directory');
  });

  it('keeps foreign HQ ecommerce brand eligible when market is US (P1b)', () => {
    const result = assessBrandCommercialEligibility({
      name: 'SHEIN',
      website: 'https://us.shein.com',
      sector: 'apparel',
      market: 'United States',
      score: 78,
      fitReason:
        'Global fashion ecommerce selling apparel to US consumers; HQ country is irrelevant',
      evidenceUrls: ['https://us.shein.com/'],
    });
    expect(result.commercialEligible).toBe(true);
  });

  it('rejects STARHUNTER when only Manage HR Magazine vendor-list evidence exists', () => {
    const result = assessBrandCommercialEligibility({
      name: 'STARHUNTER',
      website: 'https://www.starhunter.com/',
      sector: 'leadership development',
      market: 'LATAM',
      score: 80,
      fitReason:
        'Brazilian leadership development services provider with a strong presence in LATAM',
      evidenceUrls: [
        'https://leadership-development-latin-america.managehrmagazine.com/vendors/top-leadership-development-services-pproviders-in-latin-america.html',
      ],
    });
    expect(result.commercialEligible).toBe(false);
    expect(result.entityType).toBe('publisher');
  });

  it('keeps MicoachLatam personal-development service company', () => {
    const result = assessBrandCommercialEligibility({
      name: 'MicoachLatam',
      website: 'https://micoachlatam.com',
      sector: 'personal development',
      market: 'LATAM',
      score: 85,
      fitReason:
        'Personal development and coaching firm based in LATAM with a clear focus on entrepreneur and mother audiences.',
      evidenceUrls: ['https://micoachlatam.com/nosotros/'],
    });
    expect(result.commercialEligible).toBe(true);
    expect(result.entityType).toBe('service_company');
  });
});

describe('filterBrandsByCommercialEligibility', () => {
  it('filters the three real false positives and keeps a valid product brand', () => {
    const { eligible, discarded } = filterBrandsByCommercialEligibility([
      {
        name: 'UGC LATAM',
        website: 'https://ofertasugc.com',
        score: 95,
        fitReason: 'UGC community',
        evidenceUrls: ['https://ofertasugc.com/en'],
      },
      {
        name: 'Impact.com',
        website: 'https://impact.com',
        score: 85,
        fitReason: 'how to create brand ambassador programs',
        evidenceUrls: [
          'https://impact.com/influencer/how-to-create-a-brand-ambassador-program/',
        ],
      },
      {
        name: 'MDs.co',
        website: 'https://mds.co',
        score: 80,
        fitReason: 'insights on top DTC brands',
        evidenceUrls: ['https://www.mds.co/blog/top-dtc-brands'],
      },
      {
        name: 'Hatch Collection',
        website: 'https://hatchcollection.com',
        score: 82,
        fitReason: 'Maternity clothing brand for mothers',
        evidenceUrls: ['https://hatchcollection.com/'],
      },
    ]);

    expect(eligible.map((b) => b.name)).toEqual(['Hatch Collection']);
    expect(discarded).toHaveLength(3);
    expect(discarded.map((d) => d.eligibility.entityType).sort()).toEqual([
      'marketplace',
      'publisher',
      'tech_platform',
    ]);
  });

  it('filters Diana-run negatives and keeps HATCH + Micoach', () => {
    const { eligible, discarded } = filterBrandsByCommercialEligibility([
      {
        name: '500.co',
        website: 'https://500.co/',
        score: 75,
        fitReason: 'tech startup portfolio backed by early-stage venture capital',
        evidenceUrls: ['https://500.co/latam-companies'],
      },
      {
        name: 'Y Combinator',
        website: 'https://ycombinator.com/',
        score: 70,
        fitReason: 'Startup accelerator',
        evidenceUrls: ['https://ycombinator.com/companies'],
      },
      {
        name: 'F6S',
        website: 'https://f6s.com/',
        score: 60,
        fitReason: 'Startup directory',
        evidenceUrls: ['https://f6s.com/startups'],
      },
      {
        name: 'STARHUNTER',
        website: 'https://starhunter.com/',
        score: 80,
        fitReason: 'Leadership development services',
        evidenceUrls: [
          'https://leadership-development-latin-america.managehrmagazine.com/vendors/top-leadership-development-services-pproviders-in-latin-america.html',
        ],
      },
      {
        name: 'HATCH Collection',
        website: 'https://hatchcollection.com/',
        score: 70,
        fitReason: 'Maternity clothing brand',
        evidenceUrls: ['https://hatchcollection.com/'],
      },
      {
        name: 'MicoachLatam',
        website: 'https://micoachlatam.com/',
        score: 85,
        fitReason: 'Personal development and coaching firm in LATAM',
        evidenceUrls: ['https://micoachlatam.com/nosotros/'],
      },
    ]);

    expect(eligible.map((b) => b.name).sort()).toEqual([
      'HATCH Collection',
      'MicoachLatam',
    ]);
    expect(discarded).toHaveLength(4);
  });
});
