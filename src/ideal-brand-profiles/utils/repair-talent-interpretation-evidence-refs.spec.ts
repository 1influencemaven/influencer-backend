import type {
  InstagramResearchEvidenceContract,
  TalentInterpretationOutput,
} from '@influence-maven/ai-contracts';

import { repairTalentInterpretationEvidenceRefs } from './repair-talent-interpretation-evidence-refs';
import { validateTalentInterpretationAgainstEvidence } from './validate-talent-interpretation-evidence';

const evidence: InstagramResearchEvidenceContract = {
  version: 1,
  source: 'brightdata',
  fetchedAt: '2026-11-14T00:00:00.000Z',
  handleNormalized: 'pixel.vnzla',
  profileUrl: 'https://instagram.com/pixel.vnzla',
  normalized: {
    account: 'pixel.vnzla',
    displayName: 'PIXEL SPARTAN',
    biography: 'DHK SOUTH AMERICA 2024\nVENEZUELA',
    followers: 10232,
    following: 2244,
    postsCount: 583,
    isPrivate: false,
    isVerified: false,
    emailAddress: null,
    profileImageUrl: null,
    profileUrl: 'https://instagram.com/pixel.vnzla',
    externalUrls: [],
    bioHashtags: [],
    postHashtags: [
      'dancehall',
      'malandreo',
      'reykon',
      'dembow',
      'jamaica',
      'movistararena',
    ],
  },
};

describe('repairTalentInterpretationEvidenceRefs', () => {
  it('repairs PIXEL-style shorthand paths so Nest validation passes', () => {
    const interpretation: TalentInterpretationOutput = {
      outputVersion: '1.0',
      insufficientEvidence: false,
      summary: {
        text: 'Dance/music creator',
        confidence: 'medium',
        evidence: [{ fieldPath: 'postHashtags', value: 'dancehall' }],
      },
      niches: [
        {
          label: 'dance',
          rationale: 'hashtags',
          confidence: 'high',
          evidence: [{ fieldPath: 'postHashtags', value: 'dancehall' }],
        },
      ],
      contentCategories: [
        {
          label: 'music',
          rationale: 'hashtags',
          confidence: 'high',
          evidence: [
            { fieldPath: 'postHashtags', value: 'reykon, dembow, jamaica' },
          ],
        },
      ],
      commercialSignals: [
        {
          type: 'product_reference',
          label: 'Movistar Arena',
          rationale: 'mention',
          confidence: 'low',
          evidence: [{ fieldPath: 'biography', value: 'movistararena' }],
        },
      ],
      limitations: ['Limited brand references'],
    };

    const repaired = repairTalentInterpretationEvidenceRefs(
      interpretation,
      evidence,
    );

    expect(repaired.summary?.evidence[0]?.fieldPath).toBe(
      'normalized.postHashtags[0]',
    );
    expect(repaired.contentCategories[0]?.evidence[0]).toEqual({
      fieldPath: 'normalized.postHashtags[2]',
      value: 'reykon',
    });
    expect(repaired.commercialSignals[0]?.evidence[0]).toEqual({
      fieldPath: 'normalized.postHashtags[5]',
      value: 'movistararena',
    });

    expect(
      validateTalentInterpretationAgainstEvidence({
        interpretation: repaired,
        evidence,
      }),
    ).toEqual({ ok: true });
  });

  it('drops invented postContent citations (cacauzinha1-style) and keeps grounded claims', () => {
    const richEvidence: InstagramResearchEvidenceContract = {
      ...evidence,
      handleNormalized: 'cacauzinha1',
      normalized: {
        ...evidence.normalized,
        biography: 'Utah Creator Amazon Deals Lifestyle Fashion Home Decor',
        bioHashtags: ['utahinfluencer', 'fashion', 'amazoncreator', 'lifestyle'],
        postHashtags: ['homedecor', 'amazonhome', 'ad'],
        externalUrls: ['https://www.amazon.com/shop/cacauzinha1'],
      },
    };

    const interpretation: TalentInterpretationOutput = {
      outputVersion: '1.0',
      insufficientEvidence: false,
      summary: {
        text: 'Lifestyle creator',
        confidence: 'medium',
        evidence: [
          { fieldPath: 'bioHashtags', value: 'utahinfluencer' },
          {
            fieldPath: 'externalUrls',
            value: 'https://www.amazon.com/shop/cacauzinha1',
          },
        ],
      },
      niches: [
        {
          label: 'Home Decor',
          rationale: 'hashtag',
          confidence: 'low',
          evidence: [{ fieldPath: 'bioHashtags', value: 'homedecor' }],
        },
      ],
      contentCategories: [
        {
          label: 'E-commerce',
          rationale: 'amazon',
          confidence: 'high',
          evidence: [
            {
              fieldPath: 'externalUrls',
              value: 'https://www.amazon.com/shop/cacauzinha1',
            },
          ],
        },
      ],
      commercialSignals: [
        {
          type: 'product_reference',
          label: 'Amazon Deals',
          rationale: 'bio',
          confidence: 'high',
          evidence: [
            { fieldPath: 'bioHashtags', value: 'amazoncreator' },
            {
              fieldPath: 'externalUrls',
              value: 'https://www.amazon.com/shop/cacauzinha1',
            },
          ],
        },
        {
          type: 'affiliate_or_discount',
          label: 'Potential Affiliate Links',
          rationale: 'invented',
          confidence: 'medium',
          evidence: [
            {
              fieldPath: 'postContent',
              value: 'Multiple posts with affiliate links to Amazon products.',
            },
          ],
        },
      ],
      limitations: ['Limited content diversity'],
    };

    const repaired = repairTalentInterpretationEvidenceRefs(
      interpretation,
      richEvidence,
    );

    expect(
      repaired.commercialSignals.some((s) => s.type === 'affiliate_or_discount'),
    ).toBe(false);
    expect(repaired.niches[0]?.evidence[0]?.fieldPath).toBe(
      'normalized.postHashtags[0]',
    );
    expect(
      validateTalentInterpretationAgainstEvidence({
        interpretation: repaired,
        evidence: richEvidence,
      }),
    ).toEqual({ ok: true });
  });
});
