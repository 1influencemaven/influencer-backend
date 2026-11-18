import {
  AI_CONTRACT_VERSION,
  parseAiExecutionEvent,
  parseAiExecutionRequest,
  parseAiExecutionResult,
} from '@influence-maven/ai-contracts';

/**
 * Nest-side contract checks for the IBP Mastra path.
 * Uses real @influence-maven/ai-contracts parsers (no duplicated schemas).
 */
describe('IBP ai-contracts (Nest consumption)', () => {
  const executionId = '11111111-1111-4111-8111-111111111111';
  const correlationId = '22222222-2222-4222-8222-222222222222';

  it('accepts publisher-shaped IBP request', () => {
    const parsed = parseAiExecutionRequest({
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `ibp:inf-1:${executionId}`,
      requestedAt: '2026-11-01T16:26:04.000Z',
      type: 'IBP_GENERATION',
      context: {
        userId: 'system:nest-ibp',
        influencerId: 'inf-1',
        resourceId: 'inf-1',
        resourceType: 'IDEAL_BRAND_PROFILE',
      },
      instructions: { business: 'Build IBP', businessHash: 'abcdefghijklmnop' },
      configuration: { provider: 'ollama', model: 'llama3.2:3b' },
      input: {
        influencer: { id: 'inf-1', name: 'Ada', niche: 'fitness' },
      },
    });
    expect(parsed.type).toBe('IBP_GENERATION');
  });

  it('rejects invalid IBP request (missing input)', () => {
    expect(() =>
      parseAiExecutionRequest({
        contractVersion: AI_CONTRACT_VERSION,
        executionId,
        correlationId,
        idempotencyKey: 'x',
        requestedAt: '2026-11-01T16:26:04.000Z',
        type: 'IBP_GENERATION',
        context: {
          userId: 'u1',
          resourceId: 'r1',
          resourceType: 'IDEAL_BRAND_PROFILE',
        },
        instructions: { business: 'x' },
      }),
    ).toThrow();
  });

  it('accepts COMPLETED IBP result with output metadata', () => {
    const parsed = parseAiExecutionResult({
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      type: 'IBP_GENERATION',
      status: 'COMPLETED',
      startedAt: '2026-11-01T16:26:04.000Z',
      finishedAt: '2026-11-01T16:26:21.000Z',
      durationMs: 17000,
      metadata: {
        provider: 'ollama',
        model: 'llama3.2:3b',
        llmCallCount: 1,
        promptBusinessHash: 'b1e68ccf4e9b99eb',
      },
      output: {
        targetSectors: ['tech'],
        excludedSectors: [],
        brandSize: ['smb'],
        markets: ['Spain'],
        collaborationTypes: ['UGC'],
        summary: 'ok',
        alertSignals: [],
        desirableCriteria: [],
        talentInterpretation: {
          outputVersion: '1.0',
          insufficientEvidence: true,
          summary: null,
          niches: [],
          contentCategories: [],
          commercialSignals: [],
          limitations: ['No Instagram research evidence in test fixture.'],
        },
      },
    });
    expect(parsed.status).toBe('COMPLETED');
    expect(parsed.metadata.llmCallCount).toBe(1);
  });

  it('accepts FAILED IBP result with error envelope', () => {
    const parsed = parseAiExecutionResult({
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      type: 'IBP_GENERATION',
      status: 'FAILED',
      startedAt: '2026-11-01T16:26:04.000Z',
      finishedAt: '2026-11-01T16:26:21.000Z',
      durationMs: 100,
      metadata: { provider: 'ollama', model: 'llama3.2:3b' },
      error: {
        code: 'AI_PROVIDER_ERROR',
        message: 'Ollama down',
        retryable: true,
        occurredAt: '2026-11-01T16:26:21.000Z',
      },
    });
    expect(parsed.status).toBe('FAILED');
    expect(parsed.error?.code).toBe('AI_PROVIDER_ERROR');
  });

  it('rejects COMPLETED IBP result with incomplete output structure', () => {
    expect(() =>
      parseAiExecutionResult({
        contractVersion: AI_CONTRACT_VERSION,
        executionId,
        correlationId,
        type: 'IBP_GENERATION',
        status: 'COMPLETED',
        startedAt: '2026-11-01T16:26:04.000Z',
        finishedAt: '2026-11-01T16:26:21.000Z',
        durationMs: 1,
        metadata: {},
        output: { summary: 'missing arrays' },
      }),
    ).toThrow();
  });

  it('accepts observability event for IBP execution', () => {
    const parsed = parseAiExecutionEvent({
      contractVersion: AI_CONTRACT_VERSION,
      eventId: '33333333-3333-4333-8333-333333333333',
      executionId,
      correlationId,
      type: 'IBP_GENERATION',
      name: 'ai.execution.completed',
      sequence: 2,
      occurredAt: '2026-11-01T16:26:21.000Z',
      payload: { kind: 'terminal', status: 'COMPLETED' },
    });
    expect(parsed.name).toBe('ai.execution.completed');
  });

  it('rejects invalid event payload', () => {
    expect(() =>
      parseAiExecutionEvent({
        contractVersion: AI_CONTRACT_VERSION,
        eventId: 'not-a-uuid',
        executionId,
        correlationId,
        type: 'IBP_GENERATION',
        name: 'ai.execution.started',
        sequence: 1,
        occurredAt: '2026-11-01T16:26:04.000Z',
        payload: { kind: 'empty' },
      }),
    ).toThrow();
  });
});
