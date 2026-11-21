import { withTalentInterpretation } from '@influence-maven/ai-contracts';

import {
  BRAND_REFERENCE_DEFAULT_DISCLAIMER,
  isIbpStructuredValidationError,
  normalizeIbpLlmObject,
} from './normalize-ibp-llm-object';

describe('normalizeIbpLlmObject', () => {
  it('injects disclaimer for brand_reference when omitted', () => {
    const raw = withTalentInterpretation({
      targetSectors: ['gaming'],
      excludedSectors: [],
      brandSize: ['smb'],
      markets: ['LATAM'],
      collaborationTypes: ['UGC'],
      summary: 'Gaming brands.',
      alertSignals: [],
      desirableCriteria: [],
    });

    raw.talentInterpretation.insufficientEvidence = false;
    raw.talentInterpretation.summary = {
      text: 'Gamer profile',
      confidence: 'medium',
      evidence: [{ fieldPath: 'normalized.biography', value: 'Gamer' }],
    };
    raw.talentInterpretation.commercialSignals = [
      {
        type: 'brand_reference',
        label: 'SomeBrand',
        rationale: 'Mentioned in bio',
        confidence: 'low',
        evidence: [{ fieldPath: 'normalized.biography', value: 'SomeBrand' }],
      },
    ];
    raw.talentInterpretation.limitations = [];

    const normalized = normalizeIbpLlmObject(raw) as typeof raw;
    expect(normalized.talentInterpretation.commercialSignals[0]?.disclaimer).toBe(
      BRAND_REFERENCE_DEFAULT_DISCLAIMER,
    );
  });

  it('does not overwrite an existing disclaimer', () => {
    const raw = {
      talentInterpretation: {
        commercialSignals: [
          {
            type: 'brand_reference',
            label: 'X',
            rationale: 'y',
            confidence: 'low',
            evidence: [{ fieldPath: 'normalized.biography', value: 'X' }],
            disclaimer: 'Custom disclaimer',
          },
        ],
      },
    };

    const normalized = normalizeIbpLlmObject(raw) as typeof raw;
    expect(
      normalized.talentInterpretation.commercialSignals[0]?.disclaimer,
    ).toBe('Custom disclaimer');
  });

  it('coerces array/object evidence.value to scalars (PIXEL-style LLM failure)', () => {
    const raw = {
      targetSectors: ['entertainment'],
      excludedSectors: [],
      brandSize: ['smb'],
      markets: ['LATAM'],
      collaborationTypes: ['UGC'],
      summary: 'Dancehall / dembow creator.',
      alertSignals: [],
      desirableCriteria: [],
      talentInterpretation: {
        outputVersion: '1.0',
        insufficientEvidence: false,
        summary: {
          text: 'Caribbean dancehall creator',
          confidence: 'medium',
          evidence: [
            {
              fieldPath: 'normalized.postHashtags[0]',
              value: ['dancehall', 'malandreo'],
            },
          ],
        },
        niches: [
          {
            label: 'dancehall',
            rationale: 'Hashtags',
            confidence: 'high',
            evidence: [
              {
                fieldPath: 'normalized.postHashtags[0]',
                value: { tag: 'dancehall' },
              },
            ],
          },
        ],
        contentCategories: [
          {
            label: 'music',
            rationale: 'bio',
            confidence: 'medium',
            evidence: [
              {
                fieldPath: 'normalized.biography',
                value: ['DHK SOUTH AMERICA'],
              },
            ],
          },
        ],
        commercialSignals: [
          {
            type: 'brand_reference',
            label: 'movistararena',
            rationale: 'hashtag',
            confidence: 'low',
            evidence: [
              {
                fieldPath: 'normalized.postHashtags[11]',
                value: ['movistararena'],
              },
            ],
          },
        ],
        limitations: [],
      },
    };

    const normalized = normalizeIbpLlmObject(raw) as typeof raw;
    expect(normalized.talentInterpretation.summary?.evidence[0]?.value).toBe(
      'dancehall',
    );
    expect(normalized.talentInterpretation.niches[0]?.evidence[0]?.value).toBe(
      JSON.stringify({ tag: 'dancehall' }),
    );
    expect(
      normalized.talentInterpretation.contentCategories[0]?.evidence[0]?.value,
    ).toBe('DHK SOUTH AMERICA');
    expect(
      normalized.talentInterpretation.commercialSignals[0]?.evidence[0]?.value,
    ).toBe('movistararena');
    expect(
      normalized.talentInterpretation.commercialSignals[0]?.disclaimer,
    ).toMatch(/not evidence of a paid sponsorship/i);
  });

  it('detects structured validation errors from Mastra/Zod', () => {
    expect(
      isIbpStructuredValidationError(
        new Error(
          'Structured output validation failed: - talentInterpretation.summary.evidence.0.value: Invalid input',
        ),
      ),
    ).toBe(true);
  });
});
