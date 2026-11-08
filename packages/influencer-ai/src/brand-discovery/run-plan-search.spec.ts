import {
  AI_CONTRACT_VERSION,
  brandDiscoveryOutputSchema,
} from '@influence-maven/ai-contracts';
import { MastraError } from '@mastra/core/error';

import { runBrandDiscoveryPlanSearch } from './run-plan-search';

function structuredOutputValidationError(valueJson: string): MastraError {
  return new MastraError(
    {
      id: 'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED',
      domain: 'AGENT',
      category: 'SYSTEM',
      text: 'Structured output validation failed: - queries: Too small',
      details: { value: valueJson },
    },
    undefined,
  );
}

describe('runBrandDiscoveryPlanSearch', () => {
  const maxQueries = 3;

  const ibp = {
    targetSectors: ['wellness', 'sportswear'],
    excludedSectors: ['gambling'],
    brandSize: ['smb'],
    markets: ['Spain'],
    collaborationTypes: ['brand ambassador'],
    summary: 'Marcas wellness auténticas.',
    alertSignals: ['miracle claims'],
    desirableCriteria: ['sustainability'],
  };

  const planRequest = {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: '55555555-5555-4555-8555-555555555555',
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'brand-plan:run-bd-1:v1',
    requestedAt: new Date().toISOString(),
    type: 'BRAND_DISCOVERY' as const,
    context: {
      userId: 'user-1',
      influencerId: 'inf-9',
      resourceId: 'run-bd-1',
      resourceType: 'BRAND_DISCOVERY_RUN' as const,
    },
    instructions: { business: '' },
    input: {
      operation: 'PLAN_SEARCH' as const,
      influencerName: 'Ana Fit',
      niche: 'fitness',
      maxQueries,
      ibp,
    },
  };

  const validQueries = [
    'wellness sportswear brand Spain influencer marketing',
    'sustainable fitness apparel brand Spain',
  ];

  it('A: succeeds on first structured response', async () => {
    const agent = {
      generate: jest.fn().mockResolvedValue({
        object: { queries: validQueries },
        text: '',
      }),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(result.ok).toBe(true);
    expect(agent.generate).toHaveBeenCalledTimes(1);
    expect(agent.generate.mock.calls[0][0]).toContain(
      'Influencer name: Ana Fit',
    );
    expect(agent.generate.mock.calls[0][0]).toContain(
      `Max queries: ${maxQueries}`,
    );
    expect(agent.generate.mock.calls[0][0]).toContain(
      `1 to ${maxQueries} strings`,
    );
    expect(agent.generate.mock.calls[0][1]).toMatchObject({
      structuredOutput: {
        jsonPromptInjection: 'auto',
      },
    });
    expect(
      agent.generate.mock.calls[0][1].structuredOutput.schema,
    ).toBeDefined();

    if (result.ok) {
      expect(result.llmCallCount).toBe(1);
      expect(result.output.operation).toBe('PLAN_SEARCH');
      expect(result.output.queries).toEqual(validQueries);
      expect(brandDiscoveryOutputSchema.parse(result.output).operation).toBe(
        'PLAN_SEARCH',
      );
    }
  });

  it('B: retries once and succeeds when first object is invalid', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({
          object: { queries: [] },
          text: '{"queries":[]}',
        })
        .mockResolvedValueOnce({
          object: { queries: validQueries },
          text: '',
        }),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(result.ok).toBe(true);
    expect(agent.generate).toHaveBeenCalledTimes(2);

    const [firstPrompt] = agent.generate.mock.calls[0];
    const [correctionPrompt] = agent.generate.mock.calls[1];

    expect(firstPrompt).toContain('Influencer name: Ana Fit');
    expect(firstPrompt).toContain(`Max queries: ${maxQueries}`);
    expect(correctionPrompt).toContain(
      'invalid JSON for brand search strategy',
    );
    expect(correctionPrompt).toContain('Error:');
    expect(correctionPrompt).toContain(`1 to ${maxQueries} strings`);
    expect(correctionPrompt).toContain('{"queries":[]}');

    if (result.ok) {
      expect(result.llmCallCount).toBe(2);
      expect(result.output.operation).toBe('PLAN_SEARCH');
      expect(result.output.queries).toEqual(validQueries);
    }
  });

  it('C: returns AI_INVALID_OUTPUT when both attempts are invalid', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: { queries: [] }, text: '' })
        .mockResolvedValueOnce({ object: { queries: [''] }, text: '' }),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.retryable).toBe(true);
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('D: retries when structuredOutput has no object, then succeeds', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: undefined, text: 'not-json' })
        .mockResolvedValueOnce({
          object: { queries: validQueries },
          text: '',
        }),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(agent.generate.mock.calls[1][0]).toContain(
      'PLAN_SEARCH structured output missing',
    );
    expect(agent.generate.mock.calls[1][0]).toContain('not-json');
    expect(agent.generate.mock.calls[1][0]).toContain(
      `1 to ${maxQueries} strings`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.llmCallCount).toBe(2);
      expect(result.output.operation).toBe('PLAN_SEARCH');
    }
  });

  it('D: returns AI_INVALID_OUTPUT when object is missing after retry', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: undefined, text: 'first-bad' })
        .mockResolvedValueOnce({ object: undefined, text: 'second-bad' }),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.message).toMatch(/missing after retry/i);
      expect(result.retryable).toBe(true);
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('E: rejects empty queries then recovers on retry', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: { queries: [] }, text: '' })
        .mockResolvedValueOnce({
          object: { queries: ['creator partnerships Spain wellness'] },
          text: '',
        }),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.queries).toHaveLength(1);
    }
  });

  it('E: rejects more queries than maxQueries on both attempts', async () => {
    const tooMany = [
      'query one about brands',
      'query two about brands',
      'query three about brands',
      'query four about brands',
    ];

    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: { queries: tooMany }, text: '' })
        .mockResolvedValueOnce({ object: { queries: tooMany }, text: '' }),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('F: maps provider errors without extra retry', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValue(new Error('fetch failed ECONNREFUSED')),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_PROVIDER_ERROR');
      expect(result.retryable).toBe(true);
      expect(result.llmCallCount).toBe(1);
    }
  });

  it('G: maps unrecognized exceptions as AI_INTERNAL_ERROR', async () => {
    const agent = {
      generate: jest.fn().mockRejectedValue(new Error('unexpected boom')),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INTERNAL_ERROR');
      expect(result.retryable).toBe(false);
      expect(result.llmCallCount).toBe(1);
      expect(result.message).toContain('unexpected boom');
    }
  });

  it('H: classifies provider error thrown on correction call', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: { queries: [] }, text: '' })
        .mockRejectedValueOnce(new Error('Ollama timeout')),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_PROVIDER_ERROR');
      expect(result.retryable).toBe(true);
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('I: rejects non-PLAN_SEARCH operations without calling the agent', async () => {
    const scoreRequest = {
      ...planRequest,
      input: {
        operation: 'SCORE_CANDIDATES' as const,
        influencerName: 'Ana Fit',
        niche: 'fitness',
        limit: 5,
        ibp,
        searchHits: [{ title: 'Brand', url: 'https://example.com' }],
      },
    };

    const agent = {
      generate: jest.fn(),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INTERNAL_ERROR');
      expect(result.retryable).toBe(false);
      expect(result.llmCallCount).toBe(0);
      expect(result.message).toMatch(/PLAN_SEARCH only/i);
    }
  });

  it('J: recovers when Mastra structuredOutput throws on first call', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValueOnce(
          structuredOutputValidationError('{"queries":[]}'),
        )
        .mockResolvedValueOnce({
          object: { queries: validQueries },
          text: '',
        }),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(agent.generate.mock.calls[1][0]).toContain(
      'invalid JSON for brand search strategy',
    );
    expect(agent.generate.mock.calls[1][0]).toContain('{"queries":[]}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.llmCallCount).toBe(2);
      expect(result.output.operation).toBe('PLAN_SEARCH');
    }
  });

  it('K: returns AI_INVALID_OUTPUT when structuredOutput throws twice', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValueOnce(
          structuredOutputValidationError('{"queries":[]}'),
        )
        .mockRejectedValueOnce(
          structuredOutputValidationError('{"queries":[""]}'),
        ),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.retryable).toBe(true);
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('L: invalid object then structuredOutput throw yields AI_INVALID_OUTPUT', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: { queries: [] }, text: '' })
        .mockRejectedValueOnce(
          structuredOutputValidationError('{"queries":[]}'),
        ),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('M: structuredOutput throw then invalid object yields AI_INVALID_OUTPUT', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValueOnce(
          structuredOutputValidationError('{"queries":[]}'),
        )
        .mockResolvedValueOnce({ object: { queries: [''] }, text: '' }),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('N: never exceeds two LLM calls when structuredOutput keeps failing', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValue(structuredOutputValidationError('{"queries":[]}')),
    };

    const result = await runBrandDiscoveryPlanSearch(
      agent as never,
      planRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.llmCallCount).toBe(2);
    }
  });
});
