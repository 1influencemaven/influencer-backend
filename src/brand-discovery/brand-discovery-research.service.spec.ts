import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AiExecutionPublisherService } from '../ai-execution/ai-execution-publisher.service';
import { AiExecutionResultWaitService } from '../ai-execution/ai-execution-result-wait.service';
import { BrightDataSearchClient } from '../integrations/brightdata';
import { AiExecutionWaitError } from '../ai-execution/ai-execution-result-wait.errors';
import {
  BrandDiscoveryResearchService,
  formatResearchFailureWarning,
  formatResearchWaitFailureWarning,
} from './brand-discovery-research.service';
import { BrightDataWebSearchProvider } from './providers/brightdata-web-search.provider';
import type { RawBrandCandidate } from './interfaces/brand-source-provider.interface';

describe('BrandDiscoveryResearchService', () => {
  const fetchRawHtml = jest.fn();
  const search = jest.fn();
  const publishBrandDiscoveryResearch = jest.fn();
  const waitForAiExecutionResult = jest.fn();

  const candidate = (): RawBrandCandidate => ({
    name: 'Demo',
    website: 'https://demo.example',
    domain: 'demo.example',
    sector: 'software',
    market: 'Global',
    score: 80,
    fitReason: 'fit',
    source: 'mastra',
    evidenceUrls: ['https://demo.example'],
    evidenceStatus: 'VERIFIED',
  });

  const context = {
    runId: 'run-1',
    userId: 'system:brand-discovery',
    influencerId: 'inf-1',
    influencerName: 'Ana',
    ibp: {
      targetSectors: [],
      excludedSectors: [],
      brandSize: [],
      markets: [],
      collaborationTypes: [],
      summary: '',
      alertSignals: [],
      desirableCriteria: [],
    },
    promptInstructions: 'x',
  };

  let service: BrandDiscoveryResearchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    search.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        BrandDiscoveryResearchService,
        {
          provide: BrightDataSearchClient,
          useValue: { fetchRawHtml },
        },
        {
          provide: BrightDataWebSearchProvider,
          useValue: { search },
        },
        {
          provide: AiExecutionPublisherService,
          useValue: { publishBrandDiscoveryResearch },
        },
        {
          provide: AiExecutionResultWaitService,
          useValue: { waitForAiExecutionResult },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'BRAND_DISCOVERY_RESEARCH_CONCURRENCY') return 2;
              if (key === 'BRAND_DISCOVERY_RESEARCH_TIMEOUT_MS') return 1000;
              return undefined;
            },
          },
        },
      ],
    }).compile();
    service = module.get(BrandDiscoveryResearchService);
  });

  it('persists candidate with FAILED deepResearch when Unlocker returns empty', async () => {
    fetchRawHtml.mockResolvedValue({
      html: '',
      httpStatus: 200,
      elapsedMs: 10,
      emptyBody: true,
      bodyLength: 0,
      zone: 'mcp_unlocker',
      outcome: 'empty_body',
    });

    const result = await service.enrichCandidates([candidate()], context);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].score).toBe(80);
    expect(result.candidates[0].evidenceStatus).toBe('VERIFIED');
    expect(
      (result.candidates[0].metadata as { deepResearch: { researchStatus: string } })
        .deepResearch.researchStatus,
    ).toBe('FAILED');
    expect(publishBrandDiscoveryResearch).not.toHaveBeenCalled();
  });

  it('keeps candidate when Mastra wait fails', async () => {
    fetchRawHtml.mockResolvedValue({
      html: '<html><body>Demo brand about wellness</body></html>',
      httpStatus: 200,
      elapsedMs: 10,
      emptyBody: false,
      bodyLength: 40,
      zone: 'mcp_unlocker',
      outcome: 'ok',
    });
    publishBrandDiscoveryResearch.mockResolvedValue({
      executionId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
    });
    waitForAiExecutionResult.mockRejectedValue(
      new AiExecutionWaitError(
        'AI_EXECUTION_WAIT_TIMEOUT',
        'timed out',
        '11111111-1111-4111-8111-111111111111',
      ),
    );

    const result = await service.enrichCandidates([candidate()], context);
    expect(result.candidates).toHaveLength(1);
    expect(result.researchFailedCount).toBeGreaterThanOrEqual(1);
    expect(result.candidates[0].name).toBe('Demo');
    const deep = (
      result.candidates[0].metadata as {
        deepResearch: { researchStatus: string; warnings?: string[] };
      }
    ).deepResearch;
    expect(deep.researchStatus).toBe('FAILED');
    expect(deep.warnings?.[0]).toContain('AI_EXECUTION_WAIT_TIMEOUT');
    expect(deep.warnings?.[0]).not.toMatch(/timed out$/i);
  });

  it('surfaces AI_CONTEXT_INVALID from FAILED Mastra result (not timeout wording)', async () => {
    fetchRawHtml.mockResolvedValue({
      html: '<html><body>Demo brand about wellness</body></html>',
      httpStatus: 200,
      elapsedMs: 10,
      emptyBody: false,
      bodyLength: 40,
      zone: 'mcp_unlocker',
      outcome: 'ok',
    });
    publishBrandDiscoveryResearch.mockResolvedValue({
      executionId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
    });
    waitForAiExecutionResult.mockResolvedValue({
      contractVersion: '1.0',
      executionId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'BRAND_DISCOVERY',
      status: 'FAILED',
      metadata: { provider: 'ollama', model: 'qwen2.5:7b' },
      startedAt: '2026-11-14T20:00:00.000Z',
      finishedAt: '2026-11-14T20:00:00.014Z',
      durationMs: 14,
      error: {
        code: 'AI_CONTEXT_INVALID',
        message: "Invalid discriminator value. Expected 'PLAN_SEARCH' | 'SCORE_CANDIDATES'",
        retryable: false,
        occurredAt: '2026-11-14T20:00:00.014Z',
      },
    });

    const result = await service.enrichCandidates([candidate()], context);
    const deep = (
      result.candidates[0].metadata as {
        deepResearch: { researchStatus: string; warnings?: string[] };
      }
    ).deepResearch;
    expect(deep.researchStatus).toBe('FAILED');
    expect(deep.warnings?.[0]).toContain('AI_CONTEXT_INVALID');
    expect(deep.warnings?.[0]).not.toMatch(/timed out/i);
  });
});

describe('formatResearchFailureWarning', () => {
  it('includes AI_CONTEXT_INVALID code and message', () => {
    const warning = formatResearchFailureWarning({
      contractVersion: '1.0',
      executionId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      type: 'BRAND_DISCOVERY',
      status: 'FAILED',
      metadata: { provider: 'ollama', model: 'x' },
      startedAt: '2026-11-14T20:00:00.000Z',
      finishedAt: '2026-11-14T20:00:00.014Z',
      durationMs: 14,
      error: {
        code: 'AI_CONTEXT_INVALID',
        message: 'Expected PLAN_SEARCH | SCORE_CANDIDATES',
        retryable: false,
        occurredAt: '2026-11-14T20:00:00.014Z',
      },
    });
    expect(warning).toContain('AI_CONTEXT_INVALID');
    expect(warning).toContain('Expected PLAN_SEARCH');
    expect(warning).not.toMatch(/timed out/i);
  });
});

describe('formatResearchWaitFailureWarning', () => {
  it('uses wait error code for timeouts', () => {
    expect(
      formatResearchWaitFailureWarning(
        new AiExecutionWaitError(
          'AI_EXECUTION_WAIT_TIMEOUT',
          'wait exceeded',
          '11111111-1111-4111-8111-111111111111',
        ),
      ),
    ).toBe('Mastra RESEARCH_BRAND wait failed: AI_EXECUTION_WAIT_TIMEOUT');
  });
});
