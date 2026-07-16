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

  const mockInfluencer = {
    id: 'influencer-id',
    name: 'Laura Martínez',
    instagram: '@laurafit_es',
    tiktok: null,
    youtube: null,
    country: 'ES',
    language: 'es',
    niche: 'Fitness',
    subNiche: 'Nutrición deportiva',
    followers: 180000,
    engagement: null,
    email: 'laura@example.com',
    mediaKitUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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

  it('should generate and parse ideal brand profile', async () => {
    mockProvider.complete.mockResolvedValue(
      JSON.stringify({
        targetSectors: ['sportswear'],
        excludedSectors: ['alcohol'],
        brandSize: ['smb'],
        markets: ['Spain'],
        collaborationTypes: ['product launch'],
        summary: 'Healthy lifestyle brands.',
        alertSignals: [],
        desirableCriteria: ['sustainability'],
      }),
    );

    const result = await aiService.generateIdealBrandProfile(
      mockInfluencer,
      'Custom instructions for testing',
    );

    expect(result.targetSectors).toEqual(['sportswear']);
    expect(result.metadata.provider).toBe('mock');
    expect(result.metadata.lastGeneratedAt).toBeDefined();
    expect(result.metadata.promptInstructionsHash).toBeDefined();
    expect(mockProvider.complete).toHaveBeenCalledWith(
      expect.stringContaining('Custom instructions for testing'),
    );
  });
});
