import {
  classifyAgencySerpHit,
  classifyAgencySerpHits,
  titleToName,
} from './classify-agency-hit';

describe('classifyAgencySerpHit (2C.2)', () => {
  const ctx = {
    niches: ['beauty'],
    markets: ['USA'],
    country: 'US',
    fetchedAt: '2026-11-17T12:00:00.000Z',
  };

  it('classifies influencer marketing agency with evidence as RELEVANT', () => {
    const c = classifyAgencySerpHit(
      {
        title: 'Glow Collab — Influencer Marketing Agency',
        url: 'https://glowcollab.example/',
        content:
          'We are an influencer marketing agency that connects brands with creators for campaigns.',
      },
      ctx,
    );
    expect(c?.agency.agencyType).toBe('INFLUENCER_MARKETING_AGENCY');
    expect(c?.association.relevanceStatus).toBe('RELEVANT');
    expect(c?.association.evidence?.[0].url).toBe(
      'https://glowcollab.example/',
    );
    expect(c?.association.evidence?.[0].fetchedAt).toBe(ctx.fetchedAt);
  });

  it('discards directory / listicle results', () => {
    const c = classifyAgencySerpHit(
      {
        title: 'Top 10 Influencer Marketing Agencies in 2026',
        url: 'https://clutch.co/agencies/influencer-marketing',
        content: 'A roundup list of agencies compared by Clutch.',
      },
      ctx,
    );
    expect(c?.agency.agencyType).toBe('DIRECTORY');
    expect(c?.association.relevanceStatus).toBe('DISCARDED');
  });

  it('marks talent representation as NOT_RELEVANT (not IMA equivalent)', () => {
    const c = classifyAgencySerpHit(
      {
        title: 'Star Roster Talent Agency',
        url: 'https://starroster.example/',
        content: 'Talent management and exclusive representation for creators.',
      },
      ctx,
    );
    expect(c?.agency.agencyType).toBe('TALENT_REPRESENTATION');
    expect(c?.association.relevanceStatus).toBe('NOT_RELEVANT');
  });

  it('marks marketplace as NOT_RELEVANT', () => {
    const c = classifyAgencySerpHit(
      {
        title: 'CreatorHub Marketplace',
        url: 'https://creatorhub.example/',
        content: 'Self-serve influencer marketplace for brands and creators.',
      },
      ctx,
    );
    expect(c?.agency.agencyType).toBe('MARKETPLACE');
    expect(c?.association.relevanceStatus).toBe('NOT_RELEVANT');
  });

  it('marks general marketing without IMA evidence as NOT_RELEVANT', () => {
    const c = classifyAgencySerpHit(
      {
        title: 'Acme Digital Marketing Agency',
        url: 'https://acmedigital.example/',
        content: 'Full-service digital marketing agency for SEO and PPC.',
      },
      ctx,
    );
    expect(c?.agency.agencyType).toBe('GENERAL_MARKETING');
    expect(c?.association.relevanceStatus).toBe('NOT_RELEVANT');
  });

  it('keeps UNDER_REVIEW when evidence is insufficient', () => {
    const c = classifyAgencySerpHit(
      {
        title: 'Northstar Agency',
        url: 'https://northstar.example/',
        content: 'We work with influencers sometimes.',
      },
      ctx,
    );
    expect(c?.agency.agencyType).toBe('OTHER');
    expect(c?.association.relevanceStatus).toBe('UNDER_REVIEW');
  });

  it('covers all six AgencyType outcomes across a batch', () => {
    const types = new Set(
      classifyAgencySerpHits(
        [
          {
            title: 'IMA Co',
            url: 'https://ima.example/',
            content:
              'Influencer marketing agency connecting brands with creators',
          },
          {
            title: 'Talent Co',
            url: 'https://talent.example/',
            content: 'Talent agency exclusive representation roster',
          },
          {
            title: 'Market Co',
            url: 'https://market.example/',
            content: 'Influencer marketplace for brands and creators',
          },
          {
            title: 'SEO Co',
            url: 'https://seo.example/',
            content: 'Digital marketing agency SEO PPC',
          },
          {
            title: 'Top Agencies List',
            url: 'https://blog.example/best-influencer-marketing-agencies',
            content: 'Top 10 list of agencies roundup',
          },
          {
            title: 'Vague Co',
            url: 'https://vague.example/',
            content: 'Agency working with creators',
          },
        ],
        ctx,
      ).map((c) => c.agency.agencyType),
    );
    expect(types.has('INFLUENCER_MARKETING_AGENCY')).toBe(true);
    expect(types.has('TALENT_REPRESENTATION')).toBe(true);
    expect(types.has('MARKETPLACE')).toBe(true);
    expect(types.has('GENERAL_MARKETING')).toBe(true);
    expect(types.has('DIRECTORY')).toBe(true);
    expect(types.has('OTHER')).toBe(true);
  });
});

describe('listicle titles and agency names (gorjana run, 2026-11-22)', () => {
  const ctx = { fetchedAt: '2026-11-22T12:00:00.000Z' };
  const status = (title: string, url: string, content = '') =>
    classifyAgencySerpHit({ title, url, content }, ctx)?.association
      .relevanceStatus;

  it.each([
    [
      'Top Fashion Influencer Marketing Agencies for November ...',
      'https://influencerstrategists.com/x',
    ],
    [
      '19 Brands That Work with Micro Influencers (and How to ...',
      'https://manychat.com/blog/x',
    ],
    [
      'The Ultimate Guide to Influencer Marketing for Beauty Brands',
      'https://company.shopltk.com/x',
    ],
    [
      'Best Boutique Influencer Marketing Agencies',
      'https://influencer-hero.com/x',
    ],
    [
      'How to Choose an Influencer Marketing Agency?',
      'https://influencernexus.com/x',
    ],
    ['Top Beauty Marketing Agencies in the U.S.', 'https://mslk.com/x'],
  ])('discards "%s"', (title, url) => {
    expect(status(title, url)).toBe('DISCARDED');
  });

  it('keeps an agency whose title says "for brands & agencies"', () => {
    expect(
      status(
        'Acme Collective - Creator partnerships for brands & agencies',
        'https://acmecollective.com/',
        'Influencer marketing agency that connects brands with creators.',
      ),
    ).toBe('RELEVANT');
  });

  it('names the agency from the title only when the title names the site', () => {
    expect(
      titleToName(
        'Cure Media: Leading Agency for Creator-led Marketing',
        'curemedia.com',
      ),
    ).toBe('Cure Media');
    expect(
      titleToName(
        'The Shelf: Award-Winning Influencer Marketing',
        'theshelf.com',
      ),
    ).toBe('The Shelf');
    expect(
      titleToName(
        'Creator · Powering Brand-Influencer Partnerships',
        'creator.co',
      ),
    ).toBe('Creator');
    expect(
      titleToName(
        'K-Beauty Influencer Marketing Agency in the US',
        'bazzaal.com',
      ),
    ).toBe('Bazzaal');
    expect(
      titleToName(
        'Beauty & Skincare Influencer Marketing Agency',
        'disruptmarketing.co',
      ),
    ).toBe('Disruptmarketing');
  });
});
