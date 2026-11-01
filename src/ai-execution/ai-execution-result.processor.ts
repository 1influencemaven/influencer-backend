import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  parseAiExecutionResult,
  type AiExecutionResult,
} from '@influence-maven/ai-contracts';
import { Job } from 'bullmq';
import type { Prisma } from '../generated/prisma/client';

import { IbpStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_EXECUTION_JOBS,
  AI_EXECUTION_QUEUES,
} from './ai-execution.queues';

@Processor(AI_EXECUTION_QUEUES.RESULTS)
export class AiExecutionResultProcessor extends WorkerHost {
  private readonly logger = new Logger(AiExecutionResultProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.debug(
      `Consuming ai.execution.results job id=${job.id} name=${job.name}`,
    );
    if (job.name !== AI_EXECUTION_JOBS.RESULT) {
      return;
    }

    let result: AiExecutionResult;
    try {
      result = parseAiExecutionResult(job.data);
    } catch (error) {
      this.logger.error(
        `Invalid AiExecutionResult job ${job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (result.type !== 'IBP_GENERATION') {
      this.logger.warn(
        `Ignoring non-IBP result type=${result.type} executionId=${result.executionId}`,
      );
      return;
    }

    const profile = await this.prisma.idealBrandProfile.findFirst({
      where: {
        status: IbpStatus.PROCESSING,
        metadata: {
          path: ['aiExecution', 'executionId'],
          equals: result.executionId,
        },
      },
    });

    if (!profile) {
      this.logger.warn(
        `No PROCESSING IBP for executionId=${result.executionId}; skipping`,
      );
      return;
    }

    if (result.status === 'COMPLETED' && result.output) {
      const { output, metadata } = result;
      await this.prisma.idealBrandProfile.update({
        where: { id: profile.id },
        data: {
          targetSectors: output.targetSectors,
          excludedSectors: output.excludedSectors,
          brandSize: output.brandSize,
          markets: output.markets,
          collaborationTypes: output.collaborationTypes,
          summary: output.summary,
          alertSignals: output.alertSignals,
          desirableCriteria: output.desirableCriteria,
          status: IbpStatus.DRAFT,
          metadata: {
            provider: metadata.provider,
            model: metadata.model,
            lastGeneratedAt: result.finishedAt,
            promptVersion: '2',
            promptInstructionsHash: metadata.promptBusinessHash,
            llmCallCount: metadata.llmCallCount,
            aiExecution: {
              executionId: result.executionId,
              correlationId: result.correlationId,
              status: result.status,
              finishedAt: result.finishedAt,
              durationMs: result.durationMs,
            },
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `IBP DRAFT persisted via queue for influencer ${profile.influencerId} executionId=${result.executionId}`,
      );
      return;
    }

    await this.prisma.idealBrandProfile.update({
      where: { id: profile.id },
      data: {
        status: IbpStatus.FAILED,
        metadata: {
          ...(typeof profile.metadata === 'object' && profile.metadata
            ? (profile.metadata as Record<string, unknown>)
            : {}),
          aiExecution: {
            executionId: result.executionId,
            correlationId: result.correlationId,
            status: result.status,
            errorCode: result.error?.code,
            errorMessage: result.error?.message,
            finishedAt: result.finishedAt,
          },
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.error(
      `IBP FAILED via queue influencer=${profile.influencerId} code=${result.error?.code}`,
    );
  }
}
