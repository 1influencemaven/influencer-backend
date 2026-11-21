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
        talentInterpretation: {
          outputVersion: '1.0',
          insufficientEvidence: true,
          summary: null,
          niches: [],
          contentCategories: [],
          commercialSignals: [],
          limitations: ['No Instagram research evidence in example.'],
        },
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

  it('parses Brand Discovery RESEARCH_BRAND request/result (additive 1.0)', () => {
    const request = parseAiExecutionRequest({
      contractVersion: '1.0',
      executionId: '77777777-7777-4777-8777-777777777777',
      correlationId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'brand-research:run-bd-1:v1',
      type: 'BRAND_DISCOVERY',
      requestedAt: '2026-11-14T18:00:00.000Z',
      context: {
        userId: 'user-1',
        influencerId: 'inf-9',
        resourceId: 'run-bd-1',
        resourceType: 'BRAND_DISCOVERY_RUN',
      },
      instructions: { business: 'Investiga con evidencia…' },
      limits: { maxPages: 4 },
      input: {
        operation: 'RESEARCH_BRAND',
        influencerName: 'Ana Fit',
        niche: 'fitness',
        ibp: {
          targetSectors: ['wellness'],
          excludedSectors: [],
          brandSize: ['smb'],
          markets: ['Spain'],
          collaborationTypes: [],
          summary: 'x',
          alertSignals: [],
          desirableCriteria: [],
        },
        brand: {
          name: 'Demo Wellness Co',
          website: 'https://www.demowellness.example',
          domain: 'demowellness.example',
        },
        pageSnapshots: [
          {
            url: 'https://www.demowellness.example/',
            role: 'homepage',
            textContent: 'Demo Wellness Co — sportswear',
          },
        ],
        maxPages: 4,
      },
    });
    expect(request.type).toBe('BRAND_DISCOVERY');
    if (request.type === 'BRAND_DISCOVERY') {
      expect(request.input.operation).toBe('RESEARCH_BRAND');
    }

    const result = parseAiExecutionResult({
      contractVersion: '1.0',
      executionId: '77777777-7777-4777-8777-777777777777',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'BRAND_DISCOVERY',
      status: 'COMPLETED',
      startedAt: '2026-11-14T18:00:01.000Z',
      finishedAt: '2026-11-14T18:00:20.000Z',
      durationMs: 19000,
      metadata: { provider: 'ollama', model: 'llama3.2:3b', llmCallCount: 1 },
      output: {
        operation: 'RESEARCH_BRAND',
        researchStatus: 'PARTIAL',
        identity: {
          name: {
            value: 'Demo Wellness Co',
            status: 'VERIFIED',
            evidence: [{ url: 'https://www.demowellness.example/' }],
          },
          officialWebsite: {
            value: 'https://www.demowellness.example',
            status: 'VERIFIED',
            evidence: [{ url: 'https://www.demowellness.example/' }],
          },
          domain: {
            value: 'demowellness.example',
            status: 'VERIFIED',
            evidence: [{ url: 'https://www.demowellness.example/' }],
          },
        },
        company: {
          description: {
            value: null,
            status: 'NOT_FOUND',
            evidence: [],
          },
          brandSize: { value: null, status: 'NOT_FOUND', evidence: [] },
        },
        industry: {
          sectors: {
            value: ['wellness'],
            status: 'PARTIAL',
            evidence: [{ url: 'https://www.demowellness.example/' }],
          },
          categories: { value: null, status: 'NOT_FOUND', evidence: [] },
        },
        offerings: {
          productsAndServices: {
            value: null,
            status: 'NOT_FOUND',
            evidence: [],
          },
        },
        markets: {
          countriesOrRegions: {
            value: null,
            status: 'NOT_FOUND',
            evidence: [],
          },
        },
        commercialSignals: [
          {
            kind: 'affiliate',
            value: null,
            status: 'NOT_FOUND',
            evidence: [],
            note: 'No affiliate program found on consulted pages',
          },
        ],
        influencerFit: {
          rationale: {
            value: 'Possible niche overlap',
            status: 'PARTIAL',
            evidence: [{ url: 'https://www.demowellness.example/' }],
          },
        },
        pages: [
          {
            url: 'https://www.demowellness.example/',
            role: 'homepage',
            fetchStatus: 'ok',
            httpStatus: 200,
          },
        ],
      },
    });
    expect(result.type).toBe('BRAND_DISCOVERY');
    if (result.type === 'BRAND_DISCOVERY' && result.output) {
      expect(result.output.operation).toBe('RESEARCH_BRAND');
    }
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
      expect(parsed.output.operation).toBe('DECIDE_STEP');
      if (parsed.output.operation === 'DECIDE_STEP') {
        expect(parsed.output.action).toBe('search_web');
      }
    }
  });

  it('parses Contact Research FIND_BRAND_EMAILS request/result', () => {
    const request = parseAiExecutionRequest({
      contractVersion: '1.0',
      executionId: '44444444-4444-4444-8444-444444444444',
      correlationId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'contact-find:1',
      requestedAt: '2026-11-08T12:00:00.000Z',
      type: 'CONTACT_RESEARCH',
      context: {
        userId: 'u1',
        influencerId: '33333333-3333-4333-8333-333333333333',
        resourceId: '55555555-5555-4555-8555-555555555555',
        resourceType: 'CONTACT_RESEARCH_RUN',
      },
      instructions: { business: '', businessHash: 'abcdefghijklmnop' },
      input: {
        operation: 'FIND_BRAND_EMAILS',
        brandName: 'Demo Co',
        website: 'https://demo.co',
        domain: 'demo.co',
        niche: 'home',
        maxSerpQueries: 3,
        maxPages: 4,
      },
    });
    expect(request.type).toBe('CONTACT_RESEARCH');
    if (request.type === 'CONTACT_RESEARCH') {
      expect(request.input.operation).toBe('FIND_BRAND_EMAILS');
    }

    const result = parseAiExecutionResult({
      contractVersion: '1.0',
      executionId: '44444444-4444-4444-8444-444444444444',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'CONTACT_RESEARCH',
      status: 'COMPLETED',
      startedAt: '2026-11-08T12:00:00.000Z',
      finishedAt: '2026-11-08T12:00:05.000Z',
      durationMs: 5000,
      metadata: { provider: 'ollama', model: 'llama3.2:3b', llmCallCount: 1 },
      output: {
        operation: 'FIND_BRAND_EMAILS',
        outcome: 'RESULTS_FOUND',
        emails: [
          {
            email: 'partnerships@demo.co',
            sourceUrl: 'https://demo.co/contact',
            evidenceSnippet: 'Email partnerships@demo.co',
          },
        ],
        summary: '1 email',
        trace: {
          queries: ['q1'],
          pages: ['https://demo.co/contact'],
          serpCalls: 1,
          pageCalls: 1,
          // RF-04.2 optional additive counters
          pageOriginCounts: {
            seedPagesAttempted: 1,
            seedPagesDownloaded: 1,
            serpSeedPagesAttempted: 0,
            serpSeedPagesDownloaded: 0,
            llmPagesAttempted: 0,
            llmPagesDownloaded: 0,
            llmPagesReused: 0,
            duplicateUrlSkips: 0,
          },
        },
      },
    });
    expect(result.type).toBe('CONTACT_RESEARCH');
    if (result.type === 'CONTACT_RESEARCH' && result.output) {
      expect(result.output.operation).toBe('FIND_BRAND_EMAILS');
      if (result.output.operation === 'FIND_BRAND_EMAILS') {
        expect(result.output.trace?.pageOriginCounts?.seedPagesDownloaded).toBe(
          1,
        );
      }
    }

    // Historical: trace without pageOriginCounts still valid
    const legacy = parseAiExecutionResult({
      contractVersion: '1.0',
      executionId: '44444444-4444-4444-8444-444444444444',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'CONTACT_RESEARCH',
      status: 'COMPLETED',
      startedAt: '2026-11-08T12:00:00.000Z',
      finishedAt: '2026-11-08T12:00:05.000Z',
      durationMs: 5000,
      metadata: { provider: 'ollama', model: 'llama3.2:3b', llmCallCount: 1 },
      output: {
        operation: 'FIND_BRAND_EMAILS',
        outcome: 'NO_MATCHES',
        emails: [],
        trace: {
          queries: [],
          pages: [],
          serpCalls: 0,
          pageCalls: 0,
        },
      },
    });
    expect(legacy.type).toBe('CONTACT_RESEARCH');
  });

  it('parses Contact Research FIND_BRAND_PEOPLE request/result', () => {
    const request = parseAiExecutionRequest({
      contractVersion: '1.0',
      executionId: '44444444-4444-4444-8444-444444444444',
      correlationId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'contact-people:1',
      requestedAt: '2026-11-08T18:00:00.000Z',
      type: 'CONTACT_RESEARCH',
      context: {
        userId: 'u1',
        influencerId: '33333333-3333-4333-8333-333333333333',
        resourceId: '55555555-5555-4555-8555-555555555555',
        resourceType: 'CONTACT_RESEARCH_RUN',
      },
      instructions: { business: '', businessHash: 'abcdefghijklmnop' },
      input: {
        operation: 'FIND_BRAND_PEOPLE',
        brandName: 'Demo Co',
        website: 'https://demo.co',
        domain: 'demo.co',
        niche: 'wellness',
        priorityRoles: ['Influencer Marketing Manager', 'Partnerships'],
        maxSerpQueries: 4,
        maxProfilesToScrape: 5,
        maxBrandPages: 6,
        ocrEnabled: false,
      },
    });
    expect(request.type).toBe('CONTACT_RESEARCH');
    if (request.type === 'CONTACT_RESEARCH') {
      expect(request.input.operation).toBe('FIND_BRAND_PEOPLE');
      if (request.input.operation === 'FIND_BRAND_PEOPLE') {
        expect(request.input.maxProfilesToScrape).toBe(5);
        expect(request.input.ocrEnabled).toBe(false);
      }
    }

    const result = parseAiExecutionResult({
      contractVersion: '1.0',
      executionId: '44444444-4444-4444-8444-444444444444',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'CONTACT_RESEARCH',
      status: 'COMPLETED',
      startedAt: '2026-11-08T18:00:00.000Z',
      finishedAt: '2026-11-08T18:01:00.000Z',
      durationMs: 60000,
      metadata: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        llmCallCount: 1,
      },
      output: {
        operation: 'FIND_BRAND_PEOPLE',
        outcome: 'RESULTS_FOUND',
        people: [
          {
            name: 'Alex Partner',
            title: 'Influencer Marketing Manager',
            linkedinUrl: 'https://www.linkedin.com/in/alex-partner',
            emails: [
              {
                email: 'alex@demo.co',
                sourceUrl: 'https://demo.co/team',
                sourceKind: 'brand_web',
                evidenceSnippet: 'Reach Alex at alex@demo.co',
              },
            ],
          },
          {
            name: 'Sam NoEmail',
            linkedinUrl: 'https://www.linkedin.com/in/sam-noemail',
            emails: [],
          },
        ],
        summary: '2 people, 1 with email',
        trace: {
          queries: ['site:linkedin.com/in "Demo Co" partnerships'],
          linkedinUrlsConsidered: [
            'https://www.linkedin.com/in/alex-partner',
            'https://www.linkedin.com/in/sam-noemail',
          ],
          profilesScraped: 2,
          serpCalls: 2,
          brandPagesFetched: 3,
          ocrAttempts: 0,
        },
      },
    });
    expect(result.type).toBe('CONTACT_RESEARCH');
    if (result.type === 'CONTACT_RESEARCH' && result.output) {
      expect(result.output.operation).toBe('FIND_BRAND_PEOPLE');
      if (result.output.operation === 'FIND_BRAND_PEOPLE') {
        expect(result.output.people).toHaveLength(2);
        expect(result.output.people[0].emails[0].sourceKind).toBe('brand_web');
      }
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
