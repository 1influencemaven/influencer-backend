import type { TalentInterpretationOutput } from '@influence-maven/ai-contracts';

import { validateTalentInterpretationAgainstEvidence } from './validate-talent-interpretation-evidence';

const evidence = {
  version: 1 as const,
  source: 'brightdata:instagram:gd_x',
  fetchedAt: '2026-11-13T20:00:00.000Z',
  handleNormalized: 'pixel.vnzla',
  profileUrl: 'https://www.instagram.com/pixel.vnzla/',
  normalized: {
    account: 'pixel.vnzla',
    displayName: 'PIXEL',
    biography: 'Partner with Acme — #ad',
    followers: 100,
    following: 1,
    postsCount: 2,
    isPrivate: false,
    isVerified: false,
    emailAddress: null,
    profileImageUrl: null,
    profileUrl: 'https://www.instagram.com/pixel.vnzla/',
    externalUrls: ['https://acme.example'] as string[],
    bioHashtags: ['ad'] as string[],
    postHashtags: ['dancehall'] as string[],
  },
};

describe('validateTalentInterpretationAgainstEvidence', () => {
  it('accepts insufficient interpretation when evidence is missing', () => {
    const interpretation: TalentInterpretationOutput = {
      outputVersion: '1.0',
      insufficientEvidence: true,
      summary: null,
      niches: [],
      contentCategories: [],
      commercialSignals: [],
      limitations: ['Instagram research unavailable.'],
    };
    expect(
      validateTalentInterpretationAgainstEvidence({
        interpretation,
        evidence: null,
      }).ok,
    ).toBe(true);
  });

  it('rejects classifications that cite missing evidence snapshot', () => {
    const interpretation: TalentInterpretationOutput = {
      outputVersion: '1.0',
      insufficientEvidence: false,
      summary: {
        text: 'x',
        confidence: 'low',
        evidence: [
          { fieldPath: 'normalized.biography', value: 'Partner with Acme — #ad' },
        ],
      },
      niches: [
        {
          label: 'Dance',
          rationale: 'hashtag',
          confidence: 'low',
          evidence: [
            { fieldPath: 'normalized.postHashtags[0]', value: 'dancehall' },
          ],
        },
      ],
      contentCategories: [],
      commercialSignals: [],
      limitations: [],
    };
    expect(
      validateTalentInterpretationAgainstEvidence({
        interpretation,
        evidence: null,
      }).ok,
    ).toBe(false);
  });

  it('rejects unknown fieldPath', () => {
    const interpretation: TalentInterpretationOutput = {
      outputVersion: '1.0',
      insufficientEvidence: false,
      summary: {
        text: 'x',
        confidence: 'low',
        evidence: [
          { fieldPath: 'normalized.posts[0].caption', value: 'hello' },
        ],
      },
      niches: [
        {
          label: 'X',
          rationale: 'y',
          confidence: 'low',
          evidence: [
            { fieldPath: 'normalized.posts[0].caption', value: 'hello' },
          ],
        },
      ],
      contentCategories: [],
      commercialSignals: [],
      limitations: [],
    };
    const result = validateTalentInterpretationAgainstEvidence({
      interpretation,
      evidence,
    });
    expect(result.ok).toBe(false);
  });

  it('accepts brand mention and sponsorship when values match evidence', () => {
    const interpretation: TalentInterpretationOutput = {
      outputVersion: '1.0',
      insufficientEvidence: false,
      summary: {
        text: 'Creator discloses paid partnership language in bio.',
        confidence: 'medium',
        evidence: [
          {
            fieldPath: 'normalized.biography',
            value: 'Partner with Acme — #ad',
          },
        ],
      },
      niches: [],
      contentCategories: [],
      commercialSignals: [
        {
          type: 'brand_reference',
          label: 'Acme',
          rationale: 'Brand name appears in biography.',
          confidence: 'medium',
          disclaimer: 'Brand mention does not confirm a paid sponsorship.',
          evidence: [
            {
              fieldPath: 'normalized.biography',
              value: 'Partner with Acme — #ad',
            },
          ],
        },
        {
          type: 'sponsorship_disclosure',
          label: '#ad disclosure',
          rationale: 'Explicit #ad hashtag in bio hashtags.',
          confidence: 'high',
          evidence: [
            { fieldPath: 'normalized.bioHashtags[0]', value: 'ad' },
          ],
        },
      ],
      limitations: [],
    };
    expect(
      validateTalentInterpretationAgainstEvidence({
        interpretation,
        evidence,
      }).ok,
    ).toBe(true);
  });

  it('rejects value mismatch', () => {
    const interpretation: TalentInterpretationOutput = {
      outputVersion: '1.0',
      insufficientEvidence: false,
      summary: {
        text: 'x',
        confidence: 'low',
        evidence: [
          { fieldPath: 'normalized.followers', value: 999999 },
        ],
      },
      niches: [
        {
          label: 'X',
          rationale: 'y',
          confidence: 'low',
          evidence: [{ fieldPath: 'normalized.followers', value: 999999 }],
        },
      ],
      contentCategories: [],
      commercialSignals: [],
      limitations: [],
    };
    expect(
      validateTalentInterpretationAgainstEvidence({
        interpretation,
        evidence,
      }).ok,
    ).toBe(false);
  });

  it('accepts hashtag citations with # prefix or different casing', () => {
    const interpretation: TalentInterpretationOutput = {
      outputVersion: '1.0',
      insufficientEvidence: false,
      summary: {
        text: 'Dancehall creator',
        confidence: 'medium',
        evidence: [
          { fieldPath: 'normalized.postHashtags[0]', value: '#DanceHall' },
        ],
      },
      niches: [
        {
          label: 'dancehall',
          rationale: 'hashtag',
          confidence: 'high',
          evidence: [
            { fieldPath: 'normalized.postHashtags[0]', value: '#DanceHall' },
          ],
        },
      ],
      contentCategories: [],
      commercialSignals: [],
      limitations: [],
    };

    expect(
      validateTalentInterpretationAgainstEvidence({
        interpretation,
        evidence: {
          ...evidence,
          normalized: {
            ...evidence.normalized,
            postHashtags: ['dancehall', 'venezuela'],
          },
        },
      }),
    ).toEqual({ ok: true });
  });
});
