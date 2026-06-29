import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';

jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AI_JOBS } from '../../bullmq/job-types';
import { ProfileStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateInfluencerProfileProcessor } from './generate-influencer-profile.processor';

describe('GenerateInfluencerProfileProcessor', () => {
  let processor: GenerateInfluencerProfileProcessor;

  const prismaService = {
    influencer: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockInfluencer = {
    id: 'influencer-id',
    name: 'Laura Martínez',
    niche: 'Fitness',
    subNiche: 'Nutrición deportiva',
    country: 'ES',
    profileStatus: ProfileStatus.PROCESSING,
  };

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenerateInfluencerProfileProcessor,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    processor = module.get<GenerateInfluencerProfileProcessor>(
      GenerateInfluencerProfileProcessor,
    );
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should ignore unrelated jobs', async () => {
    const job = { name: 'other-job', data: {} } as Job;

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(prismaService.influencer.findUnique).not.toHaveBeenCalled();
  });

  it('should generate a mock commercial profile on success', async () => {
    prismaService.influencer.findUnique.mockResolvedValue(mockInfluencer);
    prismaService.influencer.update.mockResolvedValue({
      ...mockInfluencer,
      profileStatus: ProfileStatus.COMPLETED,
    });

    const job = {
      name: AI_JOBS.GENERATE_INFLUENCER_PROFILE,
      data: { influencerId: 'influencer-id' },
    } as Job;

    const processPromise = processor.process(job);
    await jest.runAllTimersAsync();
    await processPromise;

    expect(prismaService.influencer.update).toHaveBeenCalledTimes(1);

    type UpdateArgs = {
      where: { id: string };
      data: {
        profileStatus: ProfileStatus;
        commercialProfile: {
          idealBrands: string[];
          brandSize: string[];
        };
      };
    };

    const updateCalls = prismaService.influencer.update.mock.calls as Array<
      [UpdateArgs]
    >;
    const updateCall = updateCalls[0][0];

    expect(updateCall.where).toEqual({ id: 'influencer-id' });
    expect(updateCall.data.profileStatus).toBe(ProfileStatus.COMPLETED);
    expect(
      updateCall.data.commercialProfile.idealBrands.length,
    ).toBeGreaterThan(0);
    expect(updateCall.data.commercialProfile.brandSize).toContain('smb');
  });

  it('should skip processing when influencer does not exist', async () => {
    prismaService.influencer.findUnique.mockResolvedValue(null);

    const job = {
      name: AI_JOBS.GENERATE_INFLUENCER_PROFILE,
      data: { influencerId: 'missing-id' },
    } as Job;

    await processor.process(job);

    expect(prismaService.influencer.update).not.toHaveBeenCalled();
  });

  it('should mark profile as failed when generation throws', async () => {
    prismaService.influencer.findUnique.mockResolvedValue(mockInfluencer);
    prismaService.influencer.update.mockImplementation(
      (args: {
        data: { profileStatus?: ProfileStatus; commercialProfile?: object };
      }) => {
        if ('commercialProfile' in args.data) {
          return Promise.reject(new Error('Database error'));
        }

        return Promise.resolve({
          ...mockInfluencer,
          profileStatus: ProfileStatus.FAILED,
        });
      },
    );

    const job = {
      name: AI_JOBS.GENERATE_INFLUENCER_PROFILE,
      data: { influencerId: 'influencer-id' },
    } as Job;

    const processPromise = processor.process(job);
    const expectation =
      expect(processPromise).rejects.toThrow('Database error');
    await jest.runAllTimersAsync();
    await expectation;

    expect(prismaService.influencer.update).toHaveBeenCalledWith({
      where: { id: 'influencer-id' },
      data: { profileStatus: ProfileStatus.FAILED },
    });
  });
});
