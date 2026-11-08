import {
  AI_CONTRACT_VERSION,
  brandDiscoveryOutputSchema,
} from '@influence-maven/ai-contracts';
import { MastraError } from '@mastra/core/error';

import { runBrandDiscoveryScoreCandidates } from './run-score-candidates';

function structuredOutputValidationError(valueJson: string): MastraError {
  return new MastraError(
    {
      id: 'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED',
      domain: 'AGENT',
      category: 'SYSTEM',
      text: 'Structured output validation failed: - brands.0.website: Too small',
      details: { value: valueJson },
    },
    undefined,
  );
}

describe('runBrandDiscoveryScoreCandidates', () => {
  const limit = 2;

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

  const scoreRequest = {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: '66666666-6666-4666-8666-666666666666',
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'brand-score:run-bd-1:v1',
    requestedAt: new Date().toISOString(),
    type: 'BRAND_DISCOVERY' as const,
    context: {
      userId: 'user-1',
      influencerId: 'inf-9',
      resourceId: 'run-bd-1',
      resourceType: 'BRAND_DISCOVERY_RUN' as const,
    },
    instructions: {
      business:
        'Prefer brands with official websites and clear creator partnership signals.',
    },
    input: {
      operation: 'SCORE_CANDIDATES' as const,
      influencerName: 'Ana Fit',
      niche: 'fitness',
      limit,
      ibp,
      searchHits: [
        {
          title: 'TrailCo outdoor apparel',
          url: 'https://trailco.example',
          content: 'Spanish trail brand with creator program',
        },
        {
          title: 'HydroPeak bottles',
          url: 'https://hydropeak.example',
          content: 'Hydration gear for runners',
        },
      ],
      seedBrands: [
        {
          name: 'Seed Softwear',
          website: 'https://seedsoft.example',
          sector: 'apparel',
        },
      ],
    },
  };

  const validBrands = [
    {
      name: 'TrailCo',
      website: 'https://trailco.example',
      sector: 'outdoor apparel',
      market: 'Spain',
      brandSize: 'smb',
      score: 82,
      fitReason: 'Strong trail apparel fit with creator program in Spain.',
      evidenceUrls: ['https://trailco.example'],
    },
    {
      name: 'HydroPeak',
      website: 'https://hydropeak.example',
      sector: 'hydration',
      market: 'Spain',
      brandSize: 'smb',
      score: 74,
      fitReason: 'Hydration brand aligned with outdoor fitness niche.',
      evidenceUrls: ['https://hydropeak.example'],
    },
  ];

  it('A: succeeds on first structured response', async () => {
    const agent = {
      generate: jest.fn().mockResolvedValue({
        object: { brands: validBrands },
        text: '',
      }),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(result.ok).toBe(true);
    expect(agent.generate).toHaveBeenCalledTimes(1);
    expect(agent.generate.mock.calls[0][0]).toContain('Influencer: Ana Fit');
    expect(agent.generate.mock.calls[0][0]).toContain('SERP scenario: A');
    expect(agent.generate.mock.calls[0][0]).toContain('Limit: 2');
    expect(agent.generate.mock.calls[0][0]).toContain(
      'Prefer brands with official websites',
    );
    expect(agent.generate.mock.calls[0][0]).toContain(
      'https://trailco.example',
    );
    expect(agent.generate.mock.calls[0][0]).toContain('Seed Softwear');
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
      expect(result.output.operation).toBe('SCORE_CANDIDATES');
      expect(result.output.brands).toEqual(validBrands);
      expect(brandDiscoveryOutputSchema.parse(result.output).operation).toBe(
        'SCORE_CANDIDATES',
      );
    }
  });

  it('A2: succeeds with empty searchHits (scenario B) and empty evidenceUrls', async () => {
    const knowledgeBrand = {
      name: 'Known Fit Co',
      website: 'https://knownfit.example',
      sector: 'apparel',
      market: 'Spain',
      brandSize: 'smb',
      score: 71,
      fitReason: 'IBP sector and market alignment without SERP evidence.',
      evidenceUrls: [] as string[],
    };
    const agent = {
      generate: jest.fn().mockResolvedValue({
        object: { brands: [knowledgeBrand] },
        text: '',
      }),
    };
    const emptyHitsRequest = {
      ...scoreRequest,
      input: {
        ...scoreRequest.input,
        searchHits: [],
        seedBrands: undefined,
      },
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      emptyHitsRequest,
    );

    expect(result.ok).toBe(true);
    expect(agent.generate.mock.calls[0][0]).toContain('SERP scenario: B');
    if (result.ok) {
      expect(result.output.brands).toEqual([knowledgeBrand]);
      expect(
        brandDiscoveryOutputSchema.parse(result.output).brands[0].evidenceUrls,
      ).toEqual([]);
    }
  });

  it('B: retries once and succeeds when first object is invalid', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({
          object: { brands: [{ name: 'Broken' }] },
          text: '{"brands":[{"name":"Broken"}]}',
        })
        .mockResolvedValueOnce({
          object: { brands: validBrands },
          text: '',
        }),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(result.ok).toBe(true);
    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(agent.generate.mock.calls[0][0]).toContain('Influencer: Ana Fit');
    expect(agent.generate.mock.calls[1][0]).toContain(
      'invalid JSON for brand discovery scoring',
    );
    expect(agent.generate.mock.calls[1][0]).toContain('Error:');
    expect(agent.generate.mock.calls[1][0]).toContain(
      `at most ${limit} scored brands`,
    );

    if (result.ok) {
      expect(result.llmCallCount).toBe(2);
      expect(result.output.operation).toBe('SCORE_CANDIDATES');
      expect(result.output.brands).toHaveLength(2);
    }
  });

  it('C: returns AI_INVALID_OUTPUT when both attempts are invalid', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({
          object: { brands: [{ name: 'OnlyName' }] },
          text: '',
        })
        .mockResolvedValueOnce({
          object: { brands: [{ website: 'https://x.example' }] },
          text: '',
        }),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
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
          object: { brands: validBrands },
          text: '',
        }),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(agent.generate.mock.calls[1][0]).toContain(
      'SCORE_CANDIDATES structured output missing',
    );
    expect(agent.generate.mock.calls[1][0]).toContain('not-json');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.llmCallCount).toBe(2);
      expect(result.output.operation).toBe('SCORE_CANDIDATES');
    }
  });

  it('D: returns AI_INVALID_OUTPUT when object is missing after retry', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: undefined, text: 'first-bad' })
        .mockResolvedValueOnce({ object: undefined, text: 'second-bad' }),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
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

  it('E: rejects more brands than limit on both attempts', async () => {
    const tooMany = [
      ...validBrands,
      {
        name: 'ExtraBrand',
        website: 'https://extra.example',
        score: 60,
        fitReason: 'Extra brand beyond limit.',
        evidenceUrls: ['https://extra.example'],
      },
    ];

    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({ object: { brands: tooMany }, text: '' })
        .mockResolvedValueOnce({ object: { brands: tooMany }, text: '' }),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(agent.generate.mock.calls[1][0]).toContain(
      'invalid JSON for brand discovery scoring',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('F: rejects negative, over-100, and decimal scores then recovers', async () => {
    const negative = [
      {
        ...validBrands[0],
        score: -1,
      },
    ];
    const over = [
      {
        ...validBrands[0],
        score: 101,
      },
    ];
    const decimal = [
      {
        ...validBrands[0],
        score: 80.5,
      },
    ];

    for (const invalid of [negative, over, decimal]) {
      const agent = {
        generate: jest
          .fn()
          .mockResolvedValueOnce({ object: { brands: invalid }, text: '' })
          .mockResolvedValueOnce({
            object: { brands: [validBrands[0]] },
            text: '',
          }),
      };

      const result = await runBrandDiscoveryScoreCandidates(
        agent as never,
        scoreRequest,
      );

      expect(agent.generate).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.llmCallCount).toBe(2);
        expect(result.output.brands[0]?.score).toBe(82);
      }
    }
  });

  it('G: rejects empty fitReason, bad evidenceUrls, and missing fields', async () => {
    const cases = [
      {
        brands: [
          {
            ...validBrands[0],
            fitReason: '',
          },
        ],
      },
      {
        brands: [
          {
            ...validBrands[0],
            evidenceUrls: 'https://trailco.example',
          },
        ],
      },
      {
        brands: [
          {
            website: 'https://missing-name.example',
            score: 50,
            fitReason: 'Missing name',
            evidenceUrls: [],
          },
        ],
      },
      {
        notBrands: true,
      },
    ];

    for (const invalidObject of cases) {
      const agent = {
        generate: jest
          .fn()
          .mockResolvedValueOnce({ object: invalidObject, text: '' })
          .mockResolvedValueOnce({
            object: { brands: [validBrands[0]] },
            text: '',
          }),
      };

      const result = await runBrandDiscoveryScoreCandidates(
        agent as never,
        scoreRequest,
      );

      expect(agent.generate).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output.operation).toBe('SCORE_CANDIDATES');
      }
    }
  });

  it('H: maps provider errors without extra retry', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValue(new Error('fetch failed ECONNREFUSED')),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_PROVIDER_ERROR');
      expect(result.retryable).toBe(true);
      expect(result.llmCallCount).toBe(1);
    }
  });

  it('I: maps unrecognized exceptions as AI_INTERNAL_ERROR', async () => {
    const agent = {
      generate: jest.fn().mockRejectedValue(new Error('unexpected boom')),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
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

  it('J: classifies provider error thrown on correction call', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({
          object: { brands: [{ name: 'Broken' }] },
          text: '',
        })
        .mockRejectedValueOnce(new Error('Ollama timeout')),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_PROVIDER_ERROR');
      expect(result.retryable).toBe(true);
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('K: rejects non-SCORE_CANDIDATES operations without calling the agent', async () => {
    const planRequest = {
      ...scoreRequest,
      input: {
        operation: 'PLAN_SEARCH' as const,
        influencerName: 'Ana Fit',
        niche: 'fitness',
        maxQueries: 4,
        ibp,
      },
    };

    const agent = {
      generate: jest.fn(),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      planRequest,
    );

    expect(agent.generate).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INTERNAL_ERROR');
      expect(result.retryable).toBe(false);
      expect(result.llmCallCount).toBe(0);
      expect(result.message).toMatch(/SCORE_CANDIDATES only/i);
    }
  });

  it('uses DEFAULT scoring instructions when business is blank', async () => {
    const agent = {
      generate: jest.fn().mockResolvedValue({
        object: { brands: [validBrands[0]] },
        text: '',
      }),
    };

    const blankBusinessRequest = {
      ...scoreRequest,
      instructions: { business: '   ' },
    };

    await runBrandDiscoveryScoreCandidates(
      agent as never,
      blankBusinessRequest,
    );

    expect(agent.generate.mock.calls[0][0]).toContain(
      'B2B brand discovery assistant',
    );
  });

  it('L: recovers when Mastra structuredOutput throws on first call', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValueOnce(
          structuredOutputValidationError(
            '{"brands":[{"name":"No match","website":"","fitReason":"","score":0,"evidenceUrls":[]}]}',
          ),
        )
        .mockResolvedValueOnce({
          object: { brands: validBrands },
          text: '',
        }),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(agent.generate.mock.calls[1][0]).toContain(
      'invalid JSON for brand discovery scoring',
    );
    expect(agent.generate.mock.calls[1][0]).toContain('"No match"');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.llmCallCount).toBe(2);
      expect(result.output.operation).toBe('SCORE_CANDIDATES');
    }
  });

  it('M: returns AI_INVALID_OUTPUT when structuredOutput throws twice', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValueOnce(structuredOutputValidationError('{"brands":[]}'))
        .mockRejectedValueOnce(
          structuredOutputValidationError('{"brands":[{"name":"x"}]}'),
        ),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.retryable).toBe(true);
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('N: invalid object then structuredOutput throw yields AI_INVALID_OUTPUT', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({
          object: { brands: [{ name: 'Broken' }] },
          text: '',
        })
        .mockRejectedValueOnce(
          structuredOutputValidationError('{"brands":[]}'),
        ),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('O: structuredOutput throw then invalid object yields AI_INVALID_OUTPUT', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValueOnce(structuredOutputValidationError('{"brands":[]}'))
        .mockResolvedValueOnce({
          object: { brands: [{ name: 'StillBroken' }] },
          text: '',
        }),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AI_INVALID_OUTPUT');
      expect(result.llmCallCount).toBe(2);
    }
  });

  it('P: never exceeds two LLM calls when structuredOutput keeps failing', async () => {
    const agent = {
      generate: jest
        .fn()
        .mockRejectedValue(structuredOutputValidationError('{"brands":[]}')),
    };

    const result = await runBrandDiscoveryScoreCandidates(
      agent as never,
      scoreRequest,
    );

    expect(agent.generate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.llmCallCount).toBe(2);
      expect(result.code).toBe('AI_INVALID_OUTPUT');
    }
  });
});
