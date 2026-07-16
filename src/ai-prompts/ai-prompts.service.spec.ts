import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { DEFAULT_IBP_INSTRUCTIONS } from '../ai/prompts/generate-ibp.prompt';
import { PrismaService } from '../prisma/prisma.service';
import { AiPromptsService } from './ai-prompts.service';

describe('AiPromptsService', () => {
  let service: AiPromptsService;

  const prismaService = {
    ibpPromptTemplate: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiPromptsService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<AiPromptsService>(AiPromptsService);
    jest.clearAllMocks();
  });

  describe('getIbpTemplate', () => {
    it('should return default instructions when no template exists', async () => {
      prismaService.ibpPromptTemplate.findUnique.mockResolvedValue(null);

      const result = await service.getIbpTemplate();

      expect(result.instructions).toBe(DEFAULT_IBP_INSTRUCTIONS);
      expect(result.isDefault).toBe(true);
    });

    it('should return stored template', async () => {
      prismaService.ibpPromptTemplate.findUnique.mockResolvedValue({
        id: 'default',
        instructions: 'Custom instructions',
        updatedById: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getIbpTemplate();

      expect(result.instructions).toBe('Custom instructions');
      expect(result.isDefault).toBe(false);
    });
  });

  describe('updateIbpTemplate', () => {
    it('should upsert instructions with updatedById', async () => {
      prismaService.ibpPromptTemplate.upsert.mockResolvedValue({
        id: 'default',
        instructions: 'New instructions',
        updatedById: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.updateIbpTemplate(
        { instructions: '  New instructions  ' },
        'admin-1',
      );

      expect(prismaService.ibpPromptTemplate.upsert).toHaveBeenCalledWith({
        where: { id: 'default' },
        create: {
          id: 'default',
          instructions: 'New instructions',
          updatedById: 'admin-1',
        },
        update: {
          instructions: 'New instructions',
          updatedById: 'admin-1',
        },
        select: expect.any(Object),
      });
      expect(result.instructions).toBe('New instructions');
    });
  });

  describe('resetIbpTemplate', () => {
    it('should restore default instructions', async () => {
      prismaService.ibpPromptTemplate.upsert.mockResolvedValue({
        id: 'default',
        instructions: DEFAULT_IBP_INSTRUCTIONS,
        updatedById: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.resetIbpTemplate('admin-1');

      expect(result.isDefault).toBe(true);
      expect(result.instructions).toBe(DEFAULT_IBP_INSTRUCTIONS);
    });
  });
});
