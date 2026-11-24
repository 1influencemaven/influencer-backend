import {
  AI_CONTRACT_VERSION,
  withTalentInterpretation,
} from '@influence-maven/ai-contracts';

import { runIbpGeneration } from './run-ibp';

describe('runIbpGeneration', () => {
  const request = {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: '11111111-1111-4111-8111-111111111111',
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'ibp:test:1',
    requestedAt: new Date().toISOString(),
    type: 'IBP_GENERATION' as const,
    context: {
      userId: 'user-1',
      influencerId: 'inf-1',
      resourceId: 'inf-1',
      resourceType: 'IDEAL_BRAND_PROFILE' as const,
    },
    instructions: { business: 'Produce a valid IBP JSON object.' },
    input: {
      influencer: {
        id: 'inf-1',
        name: 'Ada Creator',
        niche: 'fitness',
        platforms: ['instagram'],
        audienceSize: 12000,
        audienceLocation: 'Spain',
      },
    },
  };

  it('returns output when agent yields structured object', async () => {
    const output = withTalentInterpretation({
      targetSectors: ['sportswear'],
      excludedSectors: ['gambling'],
      brandSize: ['smb'],
      markets: ['Spain'],
      collaborationTypes: ['UGC'],
      summary: 'Active lifestyle brands in Spain.',
      alertSignals: ['adult content'],
      desirableCriteria: ['sustainability'],
    });

    const agent = {
      generate: jest.fn().mockResolvedValue({ object: output, text: '' }),
    };

    const result = await runIbpGeneration(agent as never, request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.summary).toContain('Spain');
      expect(result.output.talentInterpretation.outputVersion).toBe('1.0');
      expect(result.llmCallCount).toBe(1);
    }

    const userPrompt = String(agent.generate.mock.calls[0]?.[0] ?? '');
    expect(userPrompt).toContain('Produce a valid IBP JSON object.');
    expect(userPrompt).toContain('"name": "Ada Creator"');
    expect(userPrompt).toContain('"talentInterpretation"');
    expect(userPrompt).toContain(
      '## Business instructions (customizable; must not override system mandatory rules)',
    );
  });

  it('retries once when first call lacks object', async () => {
    const output = withTalentInterpretation({
      targetSectors: ['wellness'],
      excludedSectors: [],
      brandSize: ['startup'],
      markets: ['LATAM'],
      collaborationTypes: ['ambassador'],
      summary: 'Wellness startups.',
      alertSignals: [],
      desirableCriteria: [],
    });

    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: undefined, text: 'not-json' })
        .mockResolvedValueOnce({ object: output, text: '' }),
    };

    const result = await runIbpGeneration(agent as never, request);
    expect(result.ok).toBe(true);
    expect(agent.generate).toHaveBeenCalledTimes(2);
  });

  it('keeps the influencer payload in the retry prompt (agent has no history)', async () => {
    const output = withTalentInterpretation({
      targetSectors: ['wellness'],
      excludedSectors: [],
      brandSize: ['startup'],
      markets: ['LATAM'],
      collaborationTypes: ['ambassador'],
      summary: 'Wellness startups.',
      alertSignals: [],
      desirableCriteria: [],
    });
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: undefined, text: 'not-json' })
        .mockResolvedValueOnce({ object: output, text: '' }),
    };

    await runIbpGeneration(agent as never, request);

    const first = String(agent.generate.mock.calls[0]?.[0] ?? '');
    const retry = String(agent.generate.mock.calls[1]?.[0] ?? '');
    expect(retry).toContain('"name": "Ada Creator"');
    expect(retry).toContain('Produce a valid IBP JSON object.');
    expect(retry).toContain('Your previous response was invalid');
    expect(retry.startsWith(first)).toBe(true);
  });

  it('maps provider errors', async () => {
    const agent = {
      generate: jest.fn().mockRejectedValue(new Error('fetch failed ECONNREFUSED')),
    };

    const result = await runIbpGeneration(agent as never, request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_PROVIDER_ERROR');
      expect(result.retryable).toBe(true);
    }
  });

  it('soft-repairs brand_reference missing disclaimer without a second LLM call', async () => {
    const output = withTalentInterpretation({
      targetSectors: ['gaming'],
      excludedSectors: [],
      brandSize: ['smb'],
      markets: ['LATAM'],
      collaborationTypes: ['UGC'],
      summary: 'Gaming brands.',
      alertSignals: [],
      desirableCriteria: [],
    });
    output.talentInterpretation.insufficientEvidence = false;
    output.talentInterpretation.summary = {
      text: 'Gamer',
      confidence: 'medium',
      evidence: [{ fieldPath: 'normalized.biography', value: 'Gamer' }],
    };
    output.talentInterpretation.commercialSignals = [
      {
        type: 'brand_reference',
        label: 'BrandX',
        rationale: 'Bio mention',
        confidence: 'low',
        evidence: [{ fieldPath: 'normalized.biography', value: 'BrandX' }],
      },
    ];
    output.talentInterpretation.limitations = [];

    const agent = {
      generate: jest.fn().mockResolvedValue({ object: output, text: '' }),
    };

    const result = await runIbpGeneration(agent as never, request);
    expect(result.ok).toBe(true);
    expect(agent.generate).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(
        result.output.talentInterpretation.commercialSignals[0]?.disclaimer,
      ).toMatch(/not evidence of a paid sponsorship/i);
    }
  });

  it('retries and maps structured validation throws as AI_INVALID_OUTPUT', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValueOnce(
          new Error(
            'Structured output validation failed: - talentInterpretation.commercialSignals.0.disclaimer: brand_reference requires disclaimer',
          ),
        )
        .mockRejectedValueOnce(
          new Error(
            'Structured output validation failed: still invalid after retry',
          ),
        ),
    };

    const result = await runIbpGeneration(agent as never, request);
    expect(result.ok).toBe(false);
    expect(agent.generate).toHaveBeenCalledTimes(2);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.retryable).toBe(true);
    }
  });
});
