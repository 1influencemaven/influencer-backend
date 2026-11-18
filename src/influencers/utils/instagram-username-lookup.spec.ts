import { buildInstagramUsernameLookup } from './instagram-username-lookup';

describe('buildInstagramUsernameLookup', () => {
  it('maps a found public profile with provider fields present only', () => {
    const result = buildInstagramUsernameLookup({
      handleNormalized: 'belu.deltoro',
      requestedProfileUrl: 'https://www.instagram.com/belu.deltoro/',
      row: {
        account: 'belu.deltoro',
        profile_name: 'Belu',
        full_name: 'Belén Del Toro',
        followers: 1200,
        following: 300,
        posts_count: 40,
        is_private: false,
        is_verified: false,
        biography: 'Creator',
        email_address: null,
        bio_hashtags: ['moda'],
        profile_url: 'https://www.instagram.com/belu.deltoro/',
        invented_should_not_appear: 'x',
      },
    });

    expect(result.outcome).toBe('FOUND');
    expect(result.normalized.displayName).toBe('Belu');
    expect(result.normalized.followers).toBe(1200);
    expect(result.normalized.bioHashtags).toEqual(['moda']);
    expect(result.provider).toHaveProperty('account');
    expect(result.provider).not.toHaveProperty('invented_should_not_appear');
  });

  it('marks private profiles', () => {
    const result = buildInstagramUsernameLookup({
      handleNormalized: 'secret',
      requestedProfileUrl: 'https://www.instagram.com/secret/',
      row: { account: 'secret', is_private: true, followers: 10 },
    });
    expect(result.outcome).toBe('PROFILE_PRIVATE');
  });

  it('marks not found warnings', () => {
    const result = buildInstagramUsernameLookup({
      handleNormalized: 'missing',
      requestedProfileUrl: 'https://www.instagram.com/missing/',
      row: { warning_code: 'dead_page', warning: 'not found' },
    });
    expect(result.outcome).toBe('PROFILE_NOT_FOUND');
  });

  it('marks incomplete when no usable signal', () => {
    const result = buildInstagramUsernameLookup({
      handleNormalized: 'empty',
      requestedProfileUrl: 'https://www.instagram.com/empty/',
      row: { id: '1', is_private: false },
    });
    expect(result.outcome).toBe('INCOMPLETE_RESPONSE');
  });
});
