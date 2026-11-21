import { mapInfluencerToIbpInput } from './map-influencer-to-ibp-input';

const evidence = {
  version: 1 as const,
  source: 'brightdata:instagram:gd_x',
  fetchedAt: '2026-11-13T20:00:00.000Z',
  handleNormalized: 'ada',
  profileUrl: 'https://www.instagram.com/ada/',
  normalized: {
    account: 'ada',
    displayName: 'Ada',
    biography: 'Fitness coach',
    followers: 10000,
    following: 1,
    postsCount: 2,
    isPrivate: false,
    isVerified: false,
    emailAddress: null,
    profileImageUrl: null,
    profileUrl: 'https://www.instagram.com/ada/',
    externalUrls: [],
    bioHashtags: [],
    postHashtags: ['fitness'],
  },
};

describe('mapInfluencerToIbpInput', () => {
  it('maps platforms and audience fields', () => {
    const input = mapInfluencerToIbpInput({
      id: 'inf-1',
      name: 'Ada',
      niche: 'fitness',
      subNiche: 'HIIT',
      country: 'Spain',
      language: 'es',
      followers: 10000,
      instagram: '@ada',
      tiktok: '@ada_tt',
      youtube: null,
      email: 'a@b.com',
    });

    expect(input.influencer.platforms).toEqual(['instagram', 'tiktok']);
    expect(input.influencer.audienceSize).toBe(10000);
    expect(input.influencer.audienceLocation).toBe('Spain');
    expect(input.influencer.notes).toContain('language=es');
    expect(input.influencer.notes).toContain('instagramResearch=unavailable');
    expect(input.instagramResearchEvidence).toBeNull();
  });

  it('includes manual niches and Instagram research evidence when present', () => {
    const input = mapInfluencerToIbpInput({
      id: 'inf-1',
      name: 'Ada',
      niches: ['Fitness', 'fitness', ' Lifestyle '],
      instagram: '@ada',
      instagramResearchEvidence: evidence,
    });

    expect(input.manualNiches).toEqual(['Fitness', 'Lifestyle']);
    expect(input.instagramResearchEvidence?.handleNormalized).toBe('ada');
    expect(input.instagramResearchEvidence?.normalized.biography).toBe(
      'Fitness coach',
    );
  });

  it('marks invalid evidence without inventing a snapshot', () => {
    const input = mapInfluencerToIbpInput({
      id: 'inf-1',
      name: 'Ada',
      instagramResearchEvidence: { version: 2, broken: true },
    });
    expect(input.instagramResearchEvidence).toBeNull();
    expect(input.influencer.notes).toContain(
      'instagramResearch=invalid_or_unparseable',
    );
  });
});
