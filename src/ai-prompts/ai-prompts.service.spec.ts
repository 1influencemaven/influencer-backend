import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS } from '../ai/prompts/generate-brand-discovery.prompt';
import { DEFAULT_IBP_INSTRUCTIONS } from '../ai/prompts/generate-ibp.prompt';
import { DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS } from '../ai/prompts/generate-lead-discovery.prompt';
import { PrismaService } from '../prisma/prisma.service';
import { AiPromptsService } from './ai-prompts.service';

describe('AiPromptsService', () => {
  let service: AiPromptsService;

  const prismaService = {
    ibpPromptTemplate: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    brandDiscoveryPromptTemplate: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    leadDiscoveryPromptTemplate: {
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

  describe('getBrandDiscoveryTemplate', () => {
    it('should return default instructions when no template exists', async () => {
      prismaService.brandDiscoveryPromptTemplate.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.getBrandDiscoveryTemplate();

      expect(result.instructions).toBe(DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS);
      expect(result.isDefault).toBe(true);
    });

    it('should return stored template', async () => {
      prismaService.brandDiscoveryPromptTemplate.findUnique.mockResolvedValue({
        id: 'default',
        instructions: 'Custom BD instructions',
        updatedById: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getBrandDiscoveryTemplate();

      expect(result.instructions).toBe('Custom BD instructions');
      expect(result.isDefault).toBe(false);
    });
  });

  describe('updateBrandDiscoveryTemplate', () => {
    it('should upsert instructions with updatedById', async () => {
      prismaService.brandDiscoveryPromptTemplate.upsert.mockResolvedValue({
        id: 'default',
        instructions: 'New BD instructions',
        updatedById: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.updateBrandDiscoveryTemplate(
        { instructions: '  New BD instructions  ' },
        'admin-1',
      );

      expect(
        prismaService.brandDiscoveryPromptTemplate.upsert,
      ).toHaveBeenCalledWith({
        where: { id: 'default' },
        create: {
          id: 'default',
          instructions: 'New BD instructions',
          updatedById: 'admin-1',
        },
        update: {
          instructions: 'New BD instructions',
          updatedById: 'admin-1',
        },
        select: expect.any(Object),
      });
      expect(result.instructions).toBe('New BD instructions');
    });
  });

  describe('resetBrandDiscoveryTemplate', () => {
    it('should restore default instructions', async () => {
      prismaService.brandDiscoveryPromptTemplate.upsert.mockResolvedValue({
        id: 'default',
        instructions: DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS,
        updatedById: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.resetBrandDiscoveryTemplate('admin-1');

      expect(result.isDefault).toBe(true);
      expect(result.instructions).toBe(DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS);
    });
  });

  describe('leadDiscoveryPromptTemplate', () => {
    it('returns default instructions when no template exists', async () => {
      prismaService.leadDiscoveryPromptTemplate.findUnique.mockResolvedValue(
        null,
      );

      const template = await service.getLeadDiscoveryTemplate();
      const instructions = await service.getLeadDiscoveryInstructions();

      expect(template.instructions).toBe(DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS);
      expect(template.isDefault).toBe(true);
      expect(instructions).toBe(DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS);
    });

    it('returns stored template instructions and falls back to default if whitespace', async () => {
      prismaService.leadDiscoveryPromptTemplate.findUnique.mockResolvedValueOnce(
        {
          id: 'default',
          instructions: '  Custom Lead Discovery instructions  ',
          updatedById: 'admin-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      );
      expect(await service.getLeadDiscoveryInstructions()).toBe(
        'Custom Lead Discovery instructions',
      );

      prismaService.leadDiscoveryPromptTemplate.findUnique.mockResolvedValueOnce(
        {
          id: 'default',
          instructions: '   ',
          updatedById: 'admin-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      );
      expect(await service.getLeadDiscoveryInstructions()).toBe(
        DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS,
      );
    });

    it('updates and resets Lead Discovery template', async () => {
      prismaService.leadDiscoveryPromptTemplate.upsert.mockResolvedValueOnce({
        id: 'default',
        instructions: 'Updated Lead Discovery',
        updatedById: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const updated = await service.updateLeadDiscoveryTemplate(
        { instructions: '  Updated Lead Discovery  ' },
        'admin-1',
      );
      expect(updated.instructions).toBe('Updated Lead Discovery');
      expect(updated.isDefault).toBe(false);

      prismaService.leadDiscoveryPromptTemplate.upsert.mockResolvedValueOnce({
        id: 'default',
        instructions: DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS,
        updatedById: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const reset = await service.resetLeadDiscoveryTemplate('admin-1');
      expect(reset.isDefault).toBe(true);
      expect(reset.instructions).toBe(DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS);
    });
  });
});
