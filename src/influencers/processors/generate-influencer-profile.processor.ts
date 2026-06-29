import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AI_JOBS } from '../../bullmq/job-types';
import { QUEUES } from '../../bullmq/queue.constants';
import type { Prisma } from '../../generated/prisma/client';
import { ProfileStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import type { GenerateInfluencerProfileJobData } from '../interfaces/commercial-profile.interface';
import { buildMockCommercialProfile } from '../utils/build-mock-commercial-profile';

const SIMULATION_DELAY_MS = 500;

@Processor(QUEUES.AI)
export class GenerateInfluencerProfileProcessor extends WorkerHost {
  private readonly logger = new Logger(GenerateInfluencerProfileProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== AI_JOBS.GENERATE_INFLUENCER_PROFILE) {
      return;
    }

    const { influencerId } = job.data as GenerateInfluencerProfileJobData;

    const influencer = await this.prisma.influencer.findUnique({
      where: { id: influencerId },
    });

    if (!influencer) {
      this.logger.warn(
        `Influencer ${influencerId} not found; skipping profile generation job`,
      );
      return;
    }

    try {
      await this.simulateGenerationDelay();

      const commercialProfile = buildMockCommercialProfile(influencer);

      await this.prisma.influencer.update({
        where: { id: influencerId },
        data: {
          commercialProfile: commercialProfile as unknown as Prisma.InputJsonValue,
          profileStatus: ProfileStatus.COMPLETED,
        },
      });

      this.logger.log(
        `Commercial profile generated for influencer ${influencerId}`,
      );
    } catch (error) {
      await this.prisma.influencer.update({
        where: { id: influencerId },
        data: { profileStatus: ProfileStatus.FAILED },
      });

      this.logger.error(
        `Failed to generate commercial profile for influencer ${influencerId}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    }
  }

  private simulateGenerationDelay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, SIMULATION_DELAY_MS));
  }
}
