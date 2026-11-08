jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { DEFAULT_IBP_INSTRUCTIONS } from '../../ai/prompts/generate-ibp.prompt';
import { IbpStatus } from '../../generated/prisma/enums';
import { GenerateIdealBrandProfileProcessor } from './generate-ideal-brand-profile.processor';

describe('GenerateIdealBrandProfileProcessor', () => {
  const influencer = {
    id: 'inf-1',
    name: 'Ada',
    niche: 'fitness',
  };

  it('publishes via AiExecutionPublisher with influencer context (Mastra path only)', async () => {
    const prisma = {
      influencer: { findUnique: jest.fn().mockResolvedValue(influencer) },
      idealBrandProfile: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    };
    const publisher = {
      publishIbpGeneration: jest.fn().mockResolvedValue({
        executionId: '11111111-1111-4111-8111-111111111111',
        correlationId: '22222222-2222-4222-8222-222222222222',
      }),
    };

    const processor = new GenerateIdealBrandProfileProcessor(
      prisma as never,
      publisher as never,
    );

    await processor.process({
      name: 'generate-ideal-brand-profile',
      data: {
        influencerId: 'inf-1',
        promptInstructions: 'x',
        requestedByUserId: 'user-42',
      },
    } as never);

    expect(publisher.publishIbpGeneration).toHaveBeenCalledTimes(1);
    expect(publisher.publishIbpGeneration).toHaveBeenCalledWith({
      influencer,
      promptInstructions: 'x',
      userId: 'user-42',
    });
    expect(prisma.idealBrandProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { influencerId: 'inf-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            aiExecution: expect.objectContaining({
              executionId: '11111111-1111-4111-8111-111111111111',
              correlationId: '22222222-2222-4222-8222-222222222222',
              transport: 'bullmq',
            }),
          }),
        }),
      }),
    );
    expect(prisma.idealBrandProfile.updateMany).not.toHaveBeenCalled();
  });

  it('defaults userId and prompt instructions when omitted', async () => {
    const prisma = {
      influencer: { findUnique: jest.fn().mockResolvedValue(influencer) },
      idealBrandProfile: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    };
    const publisher = {
      publishIbpGeneration: jest.fn().mockResolvedValue({
        executionId: '11111111-1111-4111-8111-111111111111',
        correlationId: '22222222-2222-4222-8222-222222222222',
      }),
    };

    const processor = new GenerateIdealBrandProfileProcessor(
      prisma as never,
      publisher as never,
    );

    await processor.process({
      name: 'generate-ideal-brand-profile',
      data: { influencerId: 'inf-1' },
    } as never);

    expect(publisher.publishIbpGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'system:nest-ibp',
        promptInstructions: DEFAULT_IBP_INSTRUCTIONS,
      }),
    );
  });

  it('treats whitespace-only promptInstructions as default instructions', async () => {
    const prisma = {
      influencer: { findUnique: jest.fn().mockResolvedValue(influencer) },
      idealBrandProfile: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    };
    const publisher = {
      publishIbpGeneration: jest.fn().mockResolvedValue({
        executionId: '11111111-1111-4111-8111-111111111111',
        correlationId: '22222222-2222-4222-8222-222222222222',
      }),
    };

    const processor = new GenerateIdealBrandProfileProcessor(
      prisma as never,
      publisher as never,
    );

    await processor.process({
      name: 'generate-ideal-brand-profile',
      data: { influencerId: 'inf-1', promptInstructions: '   ' },
    } as never);

    expect(publisher.publishIbpGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        promptInstructions: DEFAULT_IBP_INSTRUCTIONS,
      }),
    );
  });

  it('skips when influencer does not exist (no publish)', async () => {
    const prisma = {
      influencer: { findUnique: jest.fn().mockResolvedValue(null) },
      idealBrandProfile: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const publisher = { publishIbpGeneration: jest.fn() };

    const processor = new GenerateIdealBrandProfileProcessor(
      prisma as never,
      publisher as never,
    );

    await processor.process({
      name: 'generate-ideal-brand-profile',
      data: { influencerId: 'missing' },
    } as never);

    expect(publisher.publishIbpGeneration).not.toHaveBeenCalled();
    expect(prisma.idealBrandProfile.update).not.toHaveBeenCalled();
  });

  it('ignores unrelated BullMQ job names', async () => {
    const prisma = {
      influencer: { findUnique: jest.fn() },
      idealBrandProfile: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const publisher = { publishIbpGeneration: jest.fn() };

    const processor = new GenerateIdealBrandProfileProcessor(
      prisma as never,
      publisher as never,
    );

    await processor.process({
      name: 'other-job',
      data: { influencerId: 'inf-1' },
    } as never);

    expect(prisma.influencer.findUnique).not.toHaveBeenCalled();
    expect(publisher.publishIbpGeneration).not.toHaveBeenCalled();
  });

  it('marks IBP FAILED and rethrows when publish throws', async () => {
    const prisma = {
      influencer: { findUnique: jest.fn().mockResolvedValue(influencer) },
      idealBrandProfile: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const publisher = {
      publishIbpGeneration: jest
        .fn()
        .mockRejectedValue(new Error('redis down')),
    };

    const processor = new GenerateIdealBrandProfileProcessor(
      prisma as never,
      publisher as never,
    );

    await expect(
      processor.process({
        name: 'generate-ideal-brand-profile',
        data: { influencerId: 'inf-1' },
      } as never),
    ).rejects.toThrow('redis down');

    expect(prisma.idealBrandProfile.updateMany).toHaveBeenCalledWith({
      where: { influencerId: 'inf-1' },
      data: { status: IbpStatus.FAILED },
    });
    expect(prisma.idealBrandProfile.update).not.toHaveBeenCalled();
  });

  it('marks FAILED and rethrows when publish rejects with a non-Error value', async () => {
    const prisma = {
      influencer: { findUnique: jest.fn().mockResolvedValue(influencer) },
      idealBrandProfile: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const publisher = {
      publishIbpGeneration: jest.fn().mockRejectedValue('queue unavailable'),
    };

    const processor = new GenerateIdealBrandProfileProcessor(
      prisma as never,
      publisher as never,
    );

    await expect(
      processor.process({
        name: 'generate-ideal-brand-profile',
        data: { influencerId: 'inf-1' },
      } as never),
    ).rejects.toBe('queue unavailable');

    expect(prisma.idealBrandProfile.updateMany).toHaveBeenCalledWith({
      where: { influencerId: 'inf-1' },
      data: { status: IbpStatus.FAILED },
    });
  });
});
