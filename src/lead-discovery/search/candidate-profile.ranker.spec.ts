import type { SearchResultItem } from '../interfaces/lead-search.interface';
import { normalizePeopleLinkedInUrl } from '../utils/linkedin-url.util';
import { CandidateProfileRanker } from './candidate-profile.ranker';

/**
 * Deterministic fixture mirroring a forensic run:
 * 41 SERP hits → 4 LinkedIn `/in/` URLs → 0 above SCORE_THRESHOLD (35).
 */
function buildFortyOneHitFunnel(): SearchResultItem[] {
  const items: SearchResultItem[] = [];

  const validProfiles = [
    {
      title: 'Alex Rivera',
      url: 'https://www.linkedin.com/in/alex-rivera-123',
      snippet: 'Marketing coordinator',
      position: 1,
    },
    {
      title: 'Sam Lee',
      url: 'https://linkedin.com/in/sam-lee',
      snippet: 'Account executive',
      position: 4,
    },
    {
      title: 'Jordan Kim',
      url: 'https://www.linkedin.com/in/jordan-kim',
      snippet: 'Content creator',
      position: 7,
    },
    {
      title: 'Casey Ng',
      url: 'https://www.linkedin.com/in/casey-ng',
      snippet: 'Brand specialist',
      position: 9,
    },
  ];

  for (const profile of validProfiles) {
    items.push({
      ...profile,
      domain: 'linkedin.com',
    });
  }

  // Company / jobs / school / feed — discarded by linkedin-url.util
  const blocked = [
    'https://www.linkedin.com/company/acme-brand',
    'https://www.linkedin.com/jobs/view/12345',
    'https://www.linkedin.com/school/acme-u',
    'https://www.linkedin.com/feed/',
    'https://www.linkedin.com/posts/someone-activity-1',
  ];
  for (const [index, url] of blocked.entries()) {
    items.push({
      title: `Blocked ${index}`,
      url,
      snippet: 'Acme Brand partnerships',
      position: 10 + index,
      domain: 'linkedin.com',
    });
  }

  // Non-LinkedIn / invalid URLs
  while (items.length < 41) {
    const i = items.length;
    items.push({
      title: `Noise ${i} about Acme Brand partnerships`,
      url: `https://example.com/page-${i}`,
      snippet: 'Acme Brand influencer marketing partnerships',
      position: i + 1,
      domain: 'example.com',
    });
  }

  return items;
}

describe('CandidateProfileRanker', () => {
  const ranker = new CandidateProfileRanker();

  it('ranks linkedin profile with brand match higher', () => {
    const ranked = ranker.rank({
      items: [
        {
          title: 'Mariano Said - Liquid I.V.',
          url: 'https://www.linkedin.com/in/marianosaid',
          snippet: 'Influencer Marketing',
          position: 1,
          domain: 'linkedin.com',
        },
        {
          title: 'Random profile',
          url: 'https://www.linkedin.com/in/other-person',
          snippet: 'something else',
          position: 2,
          domain: 'linkedin.com',
        },
      ],
      query: 'test',
      provider: 'brightdata',
      brandName: 'Liquid I.V.',
      roleKeywords: ['Influencer Marketing'],
    });

    expect(ranked[0].url).toContain('marianosaid');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('dedupes by url keeping best score', () => {
    const candidates = ranker.dedupeCandidates([
      {
        url: 'https://www.linkedin.com/in/a',
        score: 10,
        reasons: [],
        searchPosition: 2,
        query: 'q',
        provider: 'brightdata',
      },
      {
        url: 'https://www.linkedin.com/in/a',
        score: 50,
        reasons: [],
        searchPosition: 1,
        query: 'q2',
        provider: 'brightdata',
      },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].score).toBe(50);
  });

  it('reproduces 41 hits → 4 LinkedIn → 0 qualified under threshold 35', () => {
    const items = buildFortyOneHitFunnel();
    expect(items).toHaveLength(41);

    const urlValidated = items.filter(
      (item) => normalizePeopleLinkedInUrl(item.url) !== null,
    );
    expect(urlValidated).toHaveLength(4);
    expect(
      items.filter((item) =>
        /linkedin\.com\/(company|jobs|school|feed|posts)\//i.test(item.url),
      ).length,
    ).toBeGreaterThan(0);

    const ranked = ranker.rank({
      items,
      query: 'Acme Brand partnerships',
      provider: 'brightdata',
      brandName: 'Acme Brand',
      roleKeywords: ['Partnerships', 'Influencer Marketing'],
    });

    expect(ranked).toHaveLength(4);
    for (const candidate of ranked) {
      expect(candidate.reasons).toContain('linkedin_in_path');
      // Weak titles: no brand in blob, no role keyword → score from position only (≤15)
      expect(candidate.score).toBeLessThan(35);
    }

    const qualified = ranker.filterByThreshold(ranked);
    expect(qualified).toHaveLength(0);
  });

  it('qualifies when brand + role + top position evidence exceeds threshold', () => {
    const ranked = ranker.rank({
      items: [
        {
          title: 'Ada Lovelace — Partnerships at Acme Brand',
          url: 'https://www.linkedin.com/in/ada-lovelace',
          snippet: 'Head of Partnerships and influencer marketing at Acme Brand',
          position: 1,
          domain: 'linkedin.com',
        },
      ],
      query: 'Acme Brand Partnerships',
      provider: 'brightdata',
      brandName: 'Acme Brand',
      roleKeywords: ['Partnerships'],
    });

    expect(ranked).toHaveLength(1);
    // position_1 (+15) + brand_match (+25) + role_match (+20) = 60 ≥ 35
    expect(ranked[0].score).toBeGreaterThanOrEqual(35);
    expect(ranked[0].reasons).toEqual(
      expect.arrayContaining([
        'linkedin_in_path',
        'position_1',
        'brand_match',
        'role_match',
      ]),
    );
    expect(ranker.filterByThreshold(ranked)).toHaveLength(1);
  });

  it('discards company, jobs, and non-profile LinkedIn URLs with clear reasons', () => {
    const ranked = ranker.rank({
      items: [
        {
          title: 'Acme Brand',
          url: 'https://www.linkedin.com/company/acme-brand',
          snippet: 'Company page',
          position: 1,
          domain: 'linkedin.com',
        },
        {
          title: 'Job',
          url: 'https://www.linkedin.com/jobs/view/999',
          snippet: 'Partnerships role',
          position: 2,
          domain: 'linkedin.com',
        },
        {
          title: 'Not linkedin',
          url: 'https://example.com/in/fake',
          snippet: 'Acme Brand Partnerships',
          position: 3,
          domain: 'example.com',
        },
        {
          title: 'Valid',
          url: 'https://www.linkedin.com/in/valid-person',
          snippet: 'Partnerships at Acme Brand',
          position: 1,
          domain: 'linkedin.com',
        },
      ],
      query: 'q',
      provider: 'brightdata',
      brandName: 'Acme Brand',
      roleKeywords: ['Partnerships'],
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].url).toBe('https://www.linkedin.com/in/valid-person');
    expect(normalizePeopleLinkedInUrl('https://www.linkedin.com/company/acme')).toBeNull();
    expect(normalizePeopleLinkedInUrl('https://www.linkedin.com/jobs/view/1')).toBeNull();
    expect(normalizePeopleLinkedInUrl('https://example.com/in/x')).toBeNull();
  });
});
