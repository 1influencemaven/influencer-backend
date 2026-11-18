import {
  instagramResearchEvidenceSchema,
  talentInterpretationOutputSchema,
} from './talent-profile-interpretation';

const sampleEvidence = {
  version: 1 as const,
  source: 'brightdata:instagram:gd_x',
  fetchedAt: '2026-11-13T20:00:00.000Z',
  handleNormalized: 'pixel.vnzla',
  profileUrl: 'https://www.instagram.com/pixel.vnzla/',
  normalized: {
    account: 'pixel.vnzla',
    displayName: 'PIXEL',
    biography: 'Dancehall · Venezuela',
    followers: 10232,
    following: 10,
    postsCount: 5,
    isPrivate: false,
    isVerified: false,
    emailAddress: null,
    profileImageUrl: null,
    profileUrl: 'https://www.instagram.com/pixel.vnzla/',
    externalUrls: [] as string[],
    bioHashtags: [] as string[],
    postHashtags: ['dancehall'],
  },
};

describe('talent-profile-interpretation contracts', () => {
  it('accepts sanitized Instagram research evidence', () => {
    expect(instagramResearchEvidenceSchema.parse(sampleEvidence).version).toBe(
      1,
    );
  });

  it('accepts insufficientEvidence output', () => {
    const parsed = talentInterpretationOutputSchema.parse({
      outputVersion: '1.0',
      insufficientEvidence: true,
      summary: null,
      niches: [],
      contentCategories: [],
      commercialSignals: [],
      limitations: ['No biography or hashtags available.'],
    });
    expect(parsed.insufficientEvidence).toBe(true);
  });

  it('rejects insufficientEvidence with niches', () => {
    const result = talentInterpretationOutputSchema.safeParse({
      outputVersion: '1.0',
      insufficientEvidence: true,
      summary: null,
      niches: [
        {
          label: 'Dance',
          rationale: 'guess',
          confidence: 'low',
          evidence: [
            { fieldPath: 'normalized.biography', value: 'Dancehall · Venezuela' },
          ],
        },
      ],
      contentCategories: [],
      commercialSignals: [],
      limitations: ['x'],
    });
    expect(result.success).toBe(false);
  });

  it('requires disclaimer on brand_reference', () => {
    const result = talentInterpretationOutputSchema.safeParse({
      outputVersion: '1.0',
      insufficientEvidence: false,
      summary: {
        text: 'Creator mentions brands in bio.',
        confidence: 'medium',
        evidence: [
          { fieldPath: 'normalized.biography', value: 'Dancehall · Venezuela' },
        ],
      },
      niches: [],
      contentCategories: [],
      commercialSignals: [
        {
          type: 'brand_reference',
          label: 'SomeBrand',
          rationale: 'Name appears in biography text.',
          confidence: 'low',
          evidence: [
            {
              fieldPath: 'normalized.biography',
              value: 'Dancehall · Venezuela',
            },
          ],
        },
      ],
      limitations: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts evidence-backed niches', () => {
    const parsed = talentInterpretationOutputSchema.parse({
      outputVersion: '1.0',
      insufficientEvidence: false,
      summary: {
        text: 'Dancehall-oriented creator.',
        confidence: 'medium',
        evidence: [
          { fieldPath: 'normalized.biography', value: 'Dancehall · Venezuela' },
        ],
      },
      niches: [
        {
          label: 'Dancehall',
          rationale: 'Biography and hashtags reference dancehall.',
          confidence: 'medium',
          evidence: [
            {
              fieldPath: 'normalized.postHashtags[0]',
              value: 'dancehall',
            },
          ],
        },
      ],
      contentCategories: [],
      commercialSignals: [],
      limitations: ['No raw posts in evidence snapshot.'],
    });
    expect(parsed.niches[0]?.label).toBe('Dancehall');
  });
});
