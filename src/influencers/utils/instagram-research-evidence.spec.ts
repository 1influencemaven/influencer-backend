import {
  INSTAGRAM_RESEARCH_EVIDENCE_VERSION,
  resolveScalarFromResearch,
  sanitizeInstagramResearchEvidence,
} from './instagram-research-evidence';

describe('instagram-research-evidence', () => {
  describe('sanitizeInstagramResearchEvidence', () => {
    it('builds a versioned snapshot from a valid lookup package', () => {
      const result = sanitizeInstagramResearchEvidence({
        source: 'brightdata:instagram:gd_x',
        fetchedAt: '2026-11-13T20:00:00.000Z',
        handleNormalized: '@Pixel.Vnzla',
        profileUrl: 'https://www.instagram.com/pixel.vnzla/',
        normalized: {
          account: 'pixel.vnzla',
          displayName: 'PIXEL',
          biography: 'Bio',
          followers: 10232,
          following: 2244,
          postsCount: 583,
          isPrivate: false,
          isVerified: false,
          emailAddress: null,
          profileImageUrl: 'https://cdn.example/img.jpg',
          profileUrl: 'https://www.instagram.com/pixel.vnzla/',
          externalUrls: ['https://example.com'],
          bioHashtags: ['venezuela'],
          postHashtags: ['dancehall'],
          ignoredExtra: 'drop-me',
        },
      });

      expect(result).toEqual({
        version: INSTAGRAM_RESEARCH_EVIDENCE_VERSION,
        source: 'brightdata:instagram:gd_x',
        fetchedAt: '2026-11-13T20:00:00.000Z',
        handleNormalized: 'pixel.vnzla',
        profileUrl: 'https://www.instagram.com/pixel.vnzla/',
        normalized: {
          account: 'pixel.vnzla',
          displayName: 'PIXEL',
          biography: 'Bio',
          followers: 10232,
          following: 2244,
          postsCount: 583,
          isPrivate: false,
          isVerified: false,
          emailAddress: null,
          profileImageUrl: 'https://cdn.example/img.jpg',
          profileUrl: 'https://www.instagram.com/pixel.vnzla/',
          externalUrls: ['https://example.com'],
          bioHashtags: ['venezuela'],
          postHashtags: ['dancehall'],
        },
      });
    });

    it('returns null when required meta is missing', () => {
      expect(
        sanitizeInstagramResearchEvidence({
          source: '',
          fetchedAt: '2026-11-13T20:00:00.000Z',
          handleNormalized: 'x',
          profileUrl: 'https://www.instagram.com/x/',
          normalized: {},
        }),
      ).toBeNull();
    });

    it('normalizes contact email and drops invalid values', () => {
      const result = sanitizeInstagramResearchEvidence({
        source: 'brightdata:instagram:gd_x',
        fetchedAt: '2026-11-13T20:00:00.000Z',
        handleNormalized: 'x',
        profileUrl: 'https://www.instagram.com/x/',
        normalized: {
          emailAddress: ' Contact@Example.COM ',
          followers: -1,
        },
      });

      expect(result?.normalized.emailAddress).toBe('contact@example.com');
      expect(result?.normalized.followers).toBeNull();
    });
  });

  describe('resolveScalarFromResearch', () => {
    it('prefers explicit DTO values over research', () => {
      expect(
        resolveScalarFromResearch({
          dtoValue: 10,
          researchValue: 99,
        }),
      ).toBe(10);
    });

    it('uses research when DTO omits the field', () => {
      expect(
        resolveScalarFromResearch({
          dtoValue: undefined,
          researchValue: 99,
        }),
      ).toBe(99);
    });

    it('does not invent values when research is empty', () => {
      expect(
        resolveScalarFromResearch({
          dtoValue: undefined,
          researchValue: null,
        }),
      ).toBeUndefined();
    });
  });
});
