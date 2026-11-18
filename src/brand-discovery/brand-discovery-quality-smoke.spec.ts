import { buildBrandDiscoveryQueries } from '../ai/prompts/generate-brand-discovery.prompt';
import { filterBrandsByCommercialEligibility } from './utils/brand-commercial-eligibility.util';
import { validateBrandSearchQueries } from './utils/brand-search-queries.util';
import { filterBrandDiscoverySearchHitsWithDiagnostics } from './utils/brand-serp-hit-filter.util';

/**
 * Controlled quality validation for Diana Marcoccia IBP.
 * Does NOT call Mastra, Bright Data, RESEARCH, or Prisma persist.
 * Run: npx jest src/brand-discovery/brand-discovery-quality-smoke.spec.ts --no-coverage
 */
describe('Brand Discovery quality smoke (Diana IBP — offline controlled)', () => {
  const ibp = {
    targetSectors: ['entrepreneurship', 'maternity', 'personal_development'],
    excludedSectors: ['alcohol', 'gambling'],
    brandSize: ['smb', 'startup'],
    markets: ['LATAM', 'United States'],
    collaborationTypes: ['brand ambassador', 'UGC'],
    summary:
      'Diana Marcoccia is an entrepreneur and mother, focusing on personal development and maternidad, making her ideal for brands targeting the Latina entrepreneur and mother audience.',
    alertSignals: ['Limited verified content'],
    desirableCriteria: [
      'Hashtags related to personal development and entrepreneurship',
    ],
  };

  const niches = [
    'Mama emprendedora',
    'maternidad',
    'mindset latina',
    'CEO',
  ];

  it('PLAN templates are concrete category×market and pass diversity validation', () => {
    const raw = buildBrandDiscoveryQueries(ibp, 'Diana Marcoccia', null, {
      niches,
    });
    const queries = validateBrandSearchQueries(raw, {
      maxQueries: 4,
      excludedSectors: ibp.excludedSectors,
    });

    // eslint-disable-next-line no-console
    console.log('\n[PLAN templates]', JSON.stringify(queries, null, 2));

    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.length).toBeLessThanOrEqual(4);
    for (const q of queries) {
      expect(q.toLowerCase()).toMatch(
        /apparel|breastfeeding|baby|postpartum|education|coaching|course|journaling|solopreneur|software/,
      );
      expect(q.toLowerCase()).not.toMatch(
        /^(entrepreneurship brands|maternity products|personal development companies)/,
      );
    }
    const modeHeavy = queries.filter((q) =>
      /\b(ugc|ambassador|affiliate|partnerships?)\b/i.test(q),
    );
    expect(modeHeavy.length).toBeLessThanOrEqual(1);
  });

  it('rejects sector-generic Diana PLAN queries (pre- and post-quality broad sets)', () => {
    const previous = [
      'LATAM entrepreneurship brands UGC opportunities',
      'personal development startups brand ambassador programs',
      'maternity SMB UGC partnerships LATAM',
      'United States personal development DTC brands',
      'entrepreneurship brands LATAM',
      'maternity products United States',
      'personal development companies LATAM',
      'smb startups entrepreneurship United States',
    ];
    const validated = validateBrandSearchQueries(previous, {
      maxQueries: 4,
      excludedSectors: ibp.excludedSectors,
    });
    // eslint-disable-next-line no-console
    console.log('\n[PLAN previous→validated]', JSON.stringify(validated, null, 2));
    expect(validated).toEqual([]);
  });

  it('classifies last-run SERP hits (marca / secundaria / ruido)', () => {
    const hits = [
      { title: 'UGC LATAM', url: 'https://ofertasugc.com/en' },
      {
        title: 'How to create a brand ambassador program',
        url: 'https://impact.com/influencer/how-to-create-a-brand-ambassador-program/',
      },
      {
        title: 'Top DTC brands',
        url: 'https://www.mds.co/blog/top-dtc-brands',
      },
      { title: 'Scribd', url: 'https://www.scribd.com/document/1' },
      {
        title: 'Maternity brand',
        url: 'https://hatchcollection.com/',
      },
    ];
    const { hits: kept, diagnostics } =
      filterBrandDiscoverySearchHitsWithDiagnostics(hits);

    const classified = hits.map((h) => {
      const discarded = diagnostics.discarded.find((d) => d.url === h.url);
      return {
        url: h.url,
        class: discarded
          ? discarded.reason === 'noise_host'
            ? 'ruido'
            : discarded.reason === 'secondary_content'
              ? 'fuente_secundaria'
              : discarded.reason
          : 'dominio_candidato',
      };
    });

    // eslint-disable-next-line no-console
    console.log('\n[SERP classification]', JSON.stringify(classified, null, 2));
    // eslint-disable-next-line no-console
    console.log('[SERP kept]', kept.map((h) => h.url));

    expect(classified).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://impact.com/influencer/how-to-create-a-brand-ambassador-program/',
          class: 'fuente_secundaria',
        }),
        expect.objectContaining({
          url: 'https://www.mds.co/blog/top-dtc-brands',
          class: 'fuente_secundaria',
        }),
        expect.objectContaining({
          url: 'https://www.scribd.com/document/1',
          class: 'ruido',
        }),
        expect.objectContaining({
          url: 'https://hatchcollection.com/',
          class: 'dominio_candidato',
        }),
      ]),
    );
  });

  it('SCORE eligibility rejects the three real false positives', () => {
    const { eligible, discarded } = filterBrandsByCommercialEligibility([
      {
        name: 'UGC LATAM',
        website: 'https://ofertasugc.com',
        score: 95,
        fitReason: 'UGC creator community',
        evidenceUrls: ['https://ofertasugc.com/en'],
      },
      {
        name: 'Impact.com',
        website: 'https://impact.com',
        score: 85,
        fitReason: 'guidance on creating brand ambassador programs',
        evidenceUrls: [
          'https://impact.com/influencer/how-to-create-a-brand-ambassador-program/',
        ],
      },
      {
        name: 'MDs.co',
        website: 'https://mds.co',
        score: 80,
        fitReason: 'insights and case studies on successful DTC brands',
        evidenceUrls: ['https://www.mds.co/blog/top-dtc-brands'],
      },
      {
        name: 'Hatch Collection',
        website: 'https://hatchcollection.com',
        score: 82,
        fitReason:
          'Maternity clothing brand for mothers; realistic collaboration with Diana',
        evidenceUrls: ['https://hatchcollection.com/'],
      },
    ]);

    // eslint-disable-next-line no-console
    console.log(
      '\n[SCORE eligible]',
      JSON.stringify(
        eligible.map((b) => ({
          name: b.name,
          domain: b.website,
          score: b.score,
          fitReason: b.fitReason,
        })),
        null,
        2,
      ),
    );
    // eslint-disable-next-line no-console
    console.log(
      '[SCORE discarded]',
      JSON.stringify(
        discarded.map((d) => ({
          name: d.brand.name,
          entityType: d.eligibility.entityType,
          reason: d.eligibility.reason,
          scoreIgnored: d.brand.score,
        })),
        null,
        2,
      ),
    );

    expect(eligible.map((b) => b.name)).toEqual(['Hatch Collection']);
    expect(discarded).toHaveLength(3);
  });

  it('SCORE eligibility rejects VC/accelerator/directory/magazine and keeps HATCH + Micoach', () => {
    const { eligible, discarded } = filterBrandsByCommercialEligibility([
      {
        name: '500.co',
        website: 'https://500.co/',
        score: 75,
        fitReason: 'portfolio backed by early-stage venture capital',
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
        fitReason: 'Leadership development',
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
