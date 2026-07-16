import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AiService } from '../../ai/ai.service';
import { DEFAULT_IBP_INSTRUCTIONS } from '../../ai/prompts/generate-ibp.prompt';
import { AI_JOBS } from '../../bullmq/job-types';
import { QUEUES } from '../../bullmq/queue.constants';
import { IbpStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import type { GenerateIdealBrandProfileJobData } from '../interfaces/generate-ideal-brand-profile-job.interface';

@Processor(QUEUES.AI)
export class GenerateIdealBrandProfileProcessor extends WorkerHost {
  private readonly logger = new Logger(GenerateIdealBrandProfileProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== AI_JOBS.GENERATE_IDEAL_BRAND_PROFILE) {
      return;
    }

    const { influencerId, promptInstructions } =
      job.data as GenerateIdealBrandProfileJobData;

    const influencer = await this.prisma.influencer.findUnique({
      where: { id: influencerId },
    });

    if (!influencer) {
      this.logger.warn(
        `Influencer ${influencerId} not found; skipping IBP generation job`,
      );
      return;
    }

    try {
      const result = await this.aiService.generateIdealBrandProfile(
        influencer,
        promptInstructions?.trim() || DEFAULT_IBP_INSTRUCTIONS,
      );
      const { metadata, ...fields } = result;

      await this.prisma.idealBrandProfile.update({
        where: { influencerId },
        data: {
          ...fields,
          status: IbpStatus.DRAFT,
          metadata,
        },
      });

      this.logger.log(
        `Ideal brand profile generated for influencer ${influencerId}`,
      );
    } catch (error) {
      await this.prisma.idealBrandProfile.updateMany({
        where: { influencerId },
        data: { status: IbpStatus.FAILED },
      });

      this.logger.error(
        `Failed to generate ideal brand profile for influencer ${influencerId}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    }
  }
}
