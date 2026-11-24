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

  it('drops null evidence.note and null disclaimer instead of failing validation', () => {
    const raw = {
      targetSectors: ['skincare'],
      excludedSectors: [],
      brandSize: ['smb'],
      markets: ['US'],
      collaborationTypes: ['UGC'],
      summary: 'Skincare brands.',
      alertSignals: [],
      desirableCriteria: [],
      talentInterpretation: {
        outputVersion: '1.0',
        insufficientEvidence: false,
        summary: {
          text: 'Skincare creator.',
          confidence: 'medium',
          evidence: [{ fieldPath: 'normalized.biography', value: 'bio', note: null }],
        },
        niches: [
          {
            label: 'Skincare',
            rationale: 'hashtags',
            confidence: 'high',
            evidence: [{ fieldPath: 'normalized.postHashtags[0]', value: 'Skincare', note: null }],
          },
        ],
        contentCategories: [],
        commercialSignals: [
          {
            type: 'business_contact',
            label: 'Public email',
            rationale: 'bio has email',
            confidence: 'high',
            evidence: [{ fieldPath: 'normalized.emailAddress', value: 'a@b.com', note: 'kept' }],
            disclaimer: null,
          },
          {
            type: 'brand_reference',
            label: 'Brand mention',
            rationale: 'mentions a brand',
            confidence: 'low',
            evidence: [{ fieldPath: 'normalized.biography', value: 'x', note: null }],
            disclaimer: null,
          },
        ],
        limitations: [],
      },
    };

    const normalized = normalizeIbpLlmObject(raw) as typeof raw;
    const ti = normalized.talentInterpretation;

    expect('note' in ti.summary.evidence[0]).toBe(false);
    expect('note' in ti.niches[0].evidence[0]).toBe(false);
    expect(ti.commercialSignals[0].evidence[0].note).toBe('kept');
    expect('disclaimer' in ti.commercialSignals[0]).toBe(false);
    expect(ti.commercialSignals[1].disclaimer).toBe(
      BRAND_REFERENCE_DEFAULT_DISCLAIMER,
    );
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
