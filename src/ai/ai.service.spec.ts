import { Test, TestingModule } from '@nestjs/testing';

import { AiService } from './ai.service';
import { LLM_PROVIDER_TOKEN } from './interfaces/llm-provider.interface';

describe('AiService', () => {
  let aiService: AiService;

  const mockProvider = {
    name: 'mock' as const,
    model: 'mock',
    complete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: LLM_PROVIDER_TOKEN, useValue: mockProvider },
      ],
    }).compile();

    aiService = module.get<AiService>(AiService);
    jest.clearAllMocks();
  });

  it('plans lead discovery without IBP generateIdealBrandProfile', async () => {
    mockProvider.complete.mockResolvedValue(
      JSON.stringify({
        scraperIds: ['gd_mock'],
        priorityRoles: ['CMO'],
        notes: 'ok',
      }),
    );

    const result = await aiService.planLeadDiscovery({
      brandName: 'Acme',
      website: 'https://acme.example',
      domain: 'acme.example',
      limit: 5,
      scraperAllowlist: [{ id: 'gd_mock', name: 'Mock' }],
    });

    expect(result.scraperIds).toEqual(['gd_mock']);
    expect(mockProvider.complete).toHaveBeenCalled();
    expect(aiService).not.toHaveProperty('generateIdealBrandProfile');
  });
});
