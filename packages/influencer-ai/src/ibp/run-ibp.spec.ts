import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

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
    const output = {
      targetSectors: ['sportswear'],
      excludedSectors: ['gambling'],
      brandSize: ['smb'],
      markets: ['Spain'],
      collaborationTypes: ['UGC'],
      summary: 'Active lifestyle brands in Spain.',
      alertSignals: ['adult content'],
      desirableCriteria: ['sustainability'],
    };

    const agent = {
      generate: jest.fn().mockResolvedValue({ object: output, text: '' }),
    };

    const result = await runIbpGeneration(agent as never, request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.summary).toContain('Spain');
      expect(result.llmCallCount).toBe(1);
    }
  });

  it('retries once when first call lacks object', async () => {
    const output = {
      targetSectors: ['wellness'],
      excludedSectors: [],
      brandSize: ['startup'],
      markets: ['LATAM'],
      collaborationTypes: ['ambassador'],
      summary: 'Wellness startups.',
      alertSignals: [],
      desirableCriteria: [],
    };

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
});
