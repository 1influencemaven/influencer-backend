import {
  parseAiExecutionEvent,
  parseAiExecutionRequest,
  parseAiExecutionResult,
} from './index';

describe('AI-002 contract examples', () => {
  it('parses IBP generation request (§14.1)', () => {
    const parsed = parseAiExecutionRequest({
      contractVersion: '1.0',
      executionId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'ibp:inf-9:hash-abc:v1',
      type: 'IBP_GENERATION',
      requestedAt: '2026-10-30T20:00:00.000Z',
      context: {
        userId: 'user-1',
        influencerId: 'inf-9',
        resourceId: 'ibp-9',
        resourceType: 'IDEAL_BRAND_PROFILE',
        locale: 'es',
        actorRole: 'ADMIN',
      },
      instructions: {
        business: 'Prioriza marcas wellness en España…',
        businessHash: 'a1b2c3d4e5f67890',
      },
      configuration: { provider: 'ollama', model: 'llama3.2:3b' },
      input: {
        influencer: {
          id: 'inf-9',
          name: 'Ana Fit',
          niche: 'fitness',
          audienceLocation: 'Spain',
        },
      },
      limits: { timeoutMs: 120000, maxLlmCalls: 2 },
    });

    expect(parsed.type).toBe('IBP_GENERATION');
    if (parsed.type === 'IBP_GENERATION') {
      expect(parsed.input.influencer.name).toBe('Ana Fit');
    }
  });

  it('parses IBP generation result (§14.2)', () => {
    const parsed = parseAiExecutionResult({
      contractVersion: '1.0',
      executionId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'IBP_GENERATION',
      status: 'COMPLETED',
      startedAt: '2026-10-30T20:00:01.000Z',
      finishedAt: '2026-10-30T20:00:08.000Z',
      durationMs: 7000,
      metadata: {
        provider: 'ollama',
        model: 'llama3.2:3b',
        llmCallCount: 1,
      },
      output: {
        targetSectors: ['wellness', 'sportswear'],
        excludedSectors: ['gambling'],
        brandSize: ['smb'],
        markets: ['Spain'],
        collaborationTypes: ['brand ambassador'],
        summary: 'Marcas wellness auténticas…',
        alertSignals: ['miracle claims'],
        desirableCriteria: ['sustainability'],
      },
    });

    expect(parsed.status).toBe('COMPLETED');
    expect(parsed.output).toBeDefined();
  });

  it('parses Brand Discovery PLAN_SEARCH request (§14.3)', () => {
    const parsed = parseAiExecutionRequest({
      contractVersion: '1.0',
      executionId: '55555555-5555-4555-8555-555555555555',
      correlationId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'brand-plan:run-bd-1:v1',
      type: 'BRAND_DISCOVERY',
      requestedAt: '2026-10-30T20:02:00.000Z',
      context: {
        userId: 'user-1',
        influencerId: 'inf-9',
        resourceId: 'run-bd-1',
        resourceType: 'BRAND_DISCOVERY_RUN',
      },
      instructions: { business: 'Prefiere evidencia en sitio oficial…' },
      configuration: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      },
      input: {
        operation: 'PLAN_SEARCH',
        influencerName: 'Ana Fit',
        niche: 'fitness',
        maxQueries: 5,
        ibp: {
          targetSectors: ['wellness', 'sportswear'],
          excludedSectors: ['gambling'],
          brandSize: ['smb'],
          markets: ['Spain'],
          collaborationTypes: ['brand ambassador'],
          summary: 'Marcas wellness…',
          alertSignals: ['miracle claims'],
          desirableCriteria: ['sustainability'],
        },
      },
    });

    expect(parsed.type).toBe('BRAND_DISCOVERY');
    if (parsed.type === 'BRAND_DISCOVERY') {
      expect(parsed.input.operation).toBe('PLAN_SEARCH');
    }
  });

  it('parses Brand Discovery PLAN_SEARCH result (§14.4)', () => {
    const parsed = parseAiExecutionResult({
      contractVersion: '1.0',
      executionId: '55555555-5555-4555-8555-555555555555',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'BRAND_DISCOVERY',
      status: 'COMPLETED',
      startedAt: '2026-10-30T20:02:01.000Z',
      finishedAt: '2026-10-30T20:02:04.000Z',
      durationMs: 3000,
      metadata: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        llmCallCount: 1,
      },
      output: {
        operation: 'PLAN_SEARCH',
        queries: [
          'wellness sportswear brand Spain influencer marketing',
          'sustainable fitness apparel brand Spain',
        ],
      },
    });

    expect(parsed.type).toBe('BRAND_DISCOVERY');
    if (parsed.type === 'BRAND_DISCOVERY' && parsed.output) {
      expect(parsed.output.operation).toBe('PLAN_SEARCH');
    }
  });

  it('parses Brand Discovery SCORE_CANDIDATES result (§14.5)', () => {
    const parsed = parseAiExecutionResult({
      contractVersion: '1.0',
      executionId: '66666666-6666-4666-8666-666666666666',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'BRAND_DISCOVERY',
      status: 'COMPLETED',
      startedAt: '2026-10-30T20:03:00.000Z',
      finishedAt: '2026-10-30T20:03:12.000Z',
      durationMs: 12000,
      metadata: {
        provider: 'ollama',
        model: 'llama3.2:3b',
        llmCallCount: 2,
      },
      output: {
        operation: 'SCORE_CANDIDATES',
        brands: [
          {
            name: 'Demo Wellness Co',
            website: 'https://www.demowellness.example',
            sector: 'wellness',
            market: 'Spain',
            brandSize: 'smb',
            score: 82,
            fitReason: 'Audience and market alignment',
            evidenceUrls: ['https://www.demowellness.example'],
          },
        ],
      },
    });

    expect(parsed.status).toBe('COMPLETED');
  });

  it('parses Lead Discovery PLAN result (§14.6)', () => {
    const parsed = parseAiExecutionResult({
      contractVersion: '1.0',
      executionId: '33333333-3333-4333-8333-333333333333',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'LEAD_DISCOVERY',
      status: 'COMPLETED',
      startedAt: '2026-10-30T20:05:01.000Z',
      finishedAt: '2026-10-30T20:05:05.000Z',
      durationMs: 4000,
      metadata: {
        provider: 'ollama',
        model: 'llama3.2:3b',
        llmCallCount: 1,
      },
      output: {
        operation: 'PLAN',
        scraperIds: ['gd_mock_scraper'],
        priorityRoles: [
          'CMO',
          'Partnerships Manager',
          'Influencer Marketing Manager',
        ],
        notes: 'Focus on partnership owners',
      },
    });

    expect(parsed.type).toBe('LEAD_DISCOVERY');
  });

  it('parses Contact Research progress event (§14.7)', () => {
    const parsed = parseAiExecutionEvent({
      contractVersion: '1.0',
      eventId: '77777777-7777-4777-8777-777777777777',
      executionId: '44444444-4444-4444-8444-444444444444',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'CONTACT_RESEARCH',
      name: 'ai.execution.progress',
      occurredAt: '2026-10-30T20:10:03.000Z',
      sequence: 3,
      payload: {
        kind: 'progress',
        stage: 'SEARCH',
        iteration: 2,
        serpQueriesUsed: 1,
        pagesFetched: 0,
        emailsFoundCount: 0,
        lastAction: 'search_web',
        message: 'Next SERP query for brand partnerships',
      },
    });

    expect(parsed.name).toBe('ai.execution.progress');
    expect(parsed.payload.kind).toBe('progress');
  });

  it('parses Contact Research DECIDE_STEP result (§14.8)', () => {
    const parsed = parseAiExecutionResult({
      contractVersion: '1.0',
      executionId: '44444444-4444-4444-8444-444444444444',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'CONTACT_RESEARCH',
      status: 'COMPLETED',
      startedAt: '2026-10-30T20:10:01.000Z',
      finishedAt: '2026-10-30T20:10:02.500Z',
      durationMs: 1500,
      metadata: {
        provider: 'ollama',
        model: 'llama3.2:3b',
        llmCallCount: 1,
      },
      output: {
        operation: 'DECIDE_STEP',
        action: 'search_web',
        reason: 'Need commercial contact pages',
        query: 'Demo Co partnerships email',
      },
    });

    expect(parsed.type).toBe('CONTACT_RESEARCH');
    if (parsed.type === 'CONTACT_RESEARCH' && parsed.output) {
      expect(parsed.output.action).toBe('search_web');
    }
  });

  it('rejects cursor as LLM provider in configuration', () => {
    expect(() =>
      parseAiExecutionRequest({
        contractVersion: '1.0',
        executionId: '11111111-1111-4111-8111-111111111111',
        correlationId: '22222222-2222-4222-8222-222222222222',
        idempotencyKey: 'x',
        type: 'IBP_GENERATION',
        requestedAt: '2026-10-30T20:00:00.000Z',
        context: {
          userId: 'user-1',
          resourceId: 'ibp-9',
          resourceType: 'IDEAL_BRAND_PROFILE',
        },
        instructions: { business: 'x' },
        configuration: { provider: 'cursor', model: 'composer-2.5' },
        input: { influencer: { id: '1', name: 'A' } },
      }),
    ).toThrow();
  });

  it('rejects PENDING on AiExecutionResult.status', () => {
    expect(() =>
      parseAiExecutionResult({
        contractVersion: '1.0',
        executionId: '11111111-1111-4111-8111-111111111111',
        correlationId: '22222222-2222-4222-8222-222222222222',
        type: 'IBP_GENERATION',
        status: 'PENDING',
        startedAt: '2026-10-30T20:00:01.000Z',
        finishedAt: '2026-10-30T20:00:08.000Z',
        durationMs: 1,
        metadata: {},
      }),
    ).toThrow();
  });
});
