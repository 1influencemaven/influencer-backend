import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { Prisma } from '../../generated/prisma/client';

import { DEFAULT_IBP_INSTRUCTIONS } from '../../ai/prompts/generate-ibp.prompt';
import { AiExecutionPublisherService } from '../../ai-execution/ai-execution-publisher.service';
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
    private readonly aiExecutionPublisher: AiExecutionPublisherService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== AI_JOBS.GENERATE_IDEAL_BRAND_PROFILE) {
      return;
    }

    const { influencerId, promptInstructions, requestedByUserId } =
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

    const instructions =
      promptInstructions?.trim() || DEFAULT_IBP_INSTRUCTIONS;

    try {
      const { executionId, correlationId } =
        await this.aiExecutionPublisher.publishIbpGeneration({
          influencer,
          userId: requestedByUserId ?? 'system:nest-ibp',
          promptInstructions: instructions,
        });

      await this.prisma.idealBrandProfile.update({
        where: { influencerId },
        data: {
          metadata: {
            aiExecution: {
              executionId,
              correlationId,
              transport: 'bullmq',
              requestedAt: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `IBP execution published to ai.execution.requests executionId=${executionId} influencer=${influencerId}`,
      );
    } catch (error) {
      await this.prisma.idealBrandProfile.updateMany({
        where: { influencerId },
        data: { status: IbpStatus.FAILED },
      });
      this.logger.error(
        `Failed to publish IBP execution for influencer ${influencerId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
