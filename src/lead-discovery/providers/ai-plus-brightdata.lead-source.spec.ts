import { ConfigService } from '@nestjs/config';

import { AiService } from '../../ai/ai.service';
import { AiPlusBrightDataLeadSource } from './ai-plus-brightdata.lead-source';

describe('AiPlusBrightDataLeadSource searchMetadata', () => {
  const client = {
    isConfigured: () => true,
    listCollectableCatalog: jest.fn().mockResolvedValue([
      { id: 'gd_people', name: 'LinkedIn People Profiles', kind: 'scraper' },
    ]),
    triggerAndCollect: jest.fn().mockResolvedValue([
      {
        name: 'Ada Lovelace',
        title: 'Partnerships',
        linkedin: 'https://linkedin.com/in/ada',
        email: 'ada@acme.com',
      },
    ]),
  };

  const configService = {
    get: jest.fn(),
  } as unknown as ConfigService;

  const aiService = {
    planLeadDiscovery: jest.fn(),
  };

  const searchOrchestrator = {
    discoverProfileUrls: jest.fn(),
  };

  let provider: AiPlusBrightDataLeadSource;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new AiPlusBrightDataLeadSource(
      client as never,
      configService,
      aiService as unknown as AiService,
      searchOrchestrator as never,
    );
    searchOrchestrator.discoverProfileUrls.mockResolvedValue({
      profileUrls: ['https://linkedin.com/in/ada'],
      plannedQueries: ['q1', 'q2', 'q3'],
      executedQueries: ['q1', 'q2'],
      searchHitsCount: 28,
      trace: {
        searchRunId: 'sr-1',
        brightDataRequests: 2,
        tavilyRequests: 0,
        fallbackActivated: false,
        queriesExecuted: 2,
        linkedinCandidatesFound: 1,
        selectedUrls: ['https://linkedin.com/in/ada'],
        failures: [],
      },
    });
  });

  const ctx = {
    brandName: 'Acme',
    website: 'https://acme.com',
    domain: 'acme.com',
    limit: 5,
    optionIds: ['autonomous'],
  };

  it('persists llm strategy metadata with roles scrapers queries and hits', async () => {
    aiService.planLeadDiscovery.mockResolvedValue({
      scraperIds: ['gd_people'],
      priorityRoles: ['Partnerships', 'CMO'],
    });

    const result = await provider.findContacts(ctx);

    expect(result.searchMetadata).toEqual({
      strategy: 'llm',
      tracks: ['2B'],
      priorityRoles: ['Partnerships', 'CMO'],
      scraperIds: ['gd_people'],
      plannedQueriesCount: 3,
      validatedQueriesCount: 2,
      queries: ['q1', 'q2'],
      fallbackUsed: false,
      fallbackReason: null,
      searchHitsCount: 28,
    });
    expect(result.contacts).toHaveLength(1);
  });

  it('marks ai_plan_failed when LLM plan throws', async () => {
    aiService.planLeadDiscovery.mockRejectedValue(new Error('llm down'));

    const result = await provider.findContacts(ctx);

    expect(result.searchMetadata?.strategy).toBe('llm');
    expect(result.searchMetadata?.fallbackUsed).toBe(true);
    expect(result.searchMetadata?.fallbackReason).toBe('ai_plan_failed');
    expect(result.searchMetadata?.tracks).toEqual(['2B']);
  });

  it('marks search_tavily when orchestrator activates Tavily fallback', async () => {
    aiService.planLeadDiscovery.mockResolvedValue({
      scraperIds: ['gd_people'],
      priorityRoles: ['CEO'],
    });
    searchOrchestrator.discoverProfileUrls.mockResolvedValue({
      profileUrls: ['https://linkedin.com/in/ada'],
      plannedQueries: ['q1'],
      executedQueries: ['q1', 'q1'],
      searchHitsCount: 20,
      trace: {
        searchRunId: 'sr-2',
        brightDataRequests: 1,
        tavilyRequests: 1,
        fallbackActivated: true,
        queriesExecuted: 1,
        linkedinCandidatesFound: 1,
        selectedUrls: ['https://linkedin.com/in/ada'],
        failures: [],
      },
    });

    const result = await provider.findContacts(ctx);

    expect(result.searchMetadata?.fallbackUsed).toBe(true);
    expect(result.searchMetadata?.fallbackReason).toBe('search_tavily');
  });

  it('returns metadata with empty contacts when no profile URLs', async () => {
    aiService.planLeadDiscovery.mockResolvedValue({
      scraperIds: ['gd_people'],
      priorityRoles: ['CEO'],
    });
    searchOrchestrator.discoverProfileUrls.mockResolvedValue({
      profileUrls: [],
      plannedQueries: ['q1'],
      executedQueries: ['q1'],
      searchHitsCount: 0,
      trace: {
        searchRunId: 'sr-3',
        brightDataRequests: 1,
        tavilyRequests: 0,
        fallbackActivated: false,
        queriesExecuted: 1,
        linkedinCandidatesFound: 0,
        selectedUrls: [],
        failures: [],
      },
    });

    const result = await provider.findContacts(ctx);

    expect(result.contacts).toEqual([]);
    expect(result.searchMetadata?.strategy).toBe('llm');
    expect(result.searchMetadata?.tracks).toEqual(['2B']);
  });
});
