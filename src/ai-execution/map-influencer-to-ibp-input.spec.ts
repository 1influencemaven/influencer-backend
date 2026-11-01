import { mapInfluencerToIbpInput } from './map-influencer-to-ibp-input';

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
  });
});
