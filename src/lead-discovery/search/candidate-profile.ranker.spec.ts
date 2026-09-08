import { CandidateProfileRanker } from './candidate-profile.ranker';

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
});
