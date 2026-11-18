import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  parseAiExecutionResult,
  talentInterpretationOutputSchema,
  type AiExecutionResult,
  type TalentInterpretationOutput,
} from '@influence-maven/ai-contracts';
import { Job } from 'bullmq';
import type { Prisma } from '../generated/prisma/client';

import { IbpStatus } from '../generated/prisma/enums';
import { repairTalentInterpretationEvidenceRefs } from '../ideal-brand-profiles/utils/repair-talent-interpretation-evidence-refs';
import { validateTalentInterpretationAgainstEvidence } from '../ideal-brand-profiles/utils/validate-talent-interpretation-evidence';
import { PrismaService } from '../prisma/prisma.service';
import { parseInstagramResearchEvidence } from './map-influencer-to-ibp-input';
import { AI_EXECUTION_JOBS, AI_EXECUTION_QUEUES } from './ai-execution.queues';

/** Prompt/product version stored in IdealBrandProfile.metadata (not AI_CONTRACT_VERSION). */
export const IBP_RESULT_PROMPT_VERSION = 'ibp-with-talent-interpretation-1';

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

      const interpretationParse = talentInterpretationOutputSchema.safeParse(
        output.talentInterpretation,
      );
      if (!interpretationParse.success) {
        await this.markFailed(profile, result, {
          errorCode: 'AI_INVALID_OUTPUT',
          errorMessage: `Invalid talentInterpretation: ${interpretationParse.error.message}`.slice(
            0,
            2000,
          ),
        });
        return;
      }

      const influencer = await this.prisma.influencer.findUnique({
        where: { id: profile.influencerId },
        select: { instagramResearchEvidence: true },
      });
      const evidence = parseInstagramResearchEvidence(
        influencer?.instagramResearchEvidence ?? null,
      );

      const repairedInterpretation = repairTalentInterpretationEvidenceRefs(
        interpretationParse.data,
        evidence,
      );

      const evidenceCheck = validateTalentInterpretationAgainstEvidence({
        interpretation: repairedInterpretation,
        evidence,
      });
      if (!evidenceCheck.ok) {
        await this.markFailed(profile, result, {
          errorCode: 'AI_INVALID_OUTPUT',
          errorMessage: evidenceCheck.message.slice(0, 2000),
        });
        return;
      }

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
            promptVersion: IBP_RESULT_PROMPT_VERSION,
            promptInstructionsHash: metadata.promptBusinessHash,
            llmCallCount: metadata.llmCallCount,
            aiExecution: {
              executionId: result.executionId,
              correlationId: result.correlationId,
              status: result.status,
              finishedAt: result.finishedAt,
              durationMs: result.durationMs,
            },
            talentInterpretation: repairedInterpretation,
          },
        },
      });

      this.logger.log(
        `IBP DRAFT persisted via queue for influencer ${profile.influencerId} executionId=${result.executionId}`,
      );
      return;
    }

    await this.markFailed(profile, result, {
      errorCode: result.error?.code,
      errorMessage: result.error?.message,
    });
  }

  private async markFailed(
    profile: { id: string; influencerId: string; metadata: unknown },
    result: Extract<AiExecutionResult, { type: 'IBP_GENERATION' }>,
    error: { errorCode?: string; errorMessage?: string },
  ) {
    const previous =
      typeof profile.metadata === 'object' && profile.metadata
        ? (profile.metadata as Record<string, unknown>)
        : {};

    await this.prisma.idealBrandProfile.update({
      where: { id: profile.id },
      data: {
        status: IbpStatus.FAILED,
        metadata: {
          ...previous,
          aiExecution: {
            executionId: result.executionId,
            correlationId: result.correlationId,
            status: result.status === 'COMPLETED' ? 'FAILED' : result.status,
            errorCode: error.errorCode ?? result.error?.code,
            errorMessage: error.errorMessage ?? result.error?.message,
            finishedAt: result.finishedAt,
          },
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.error(
      `IBP FAILED via queue influencer=${profile.influencerId} code=${error.errorCode ?? result.error?.code}`,
    );
  }
}

/** Type export for FE/docs consumers of metadata.talentInterpretation. */
export type PersistedTalentInterpretation = TalentInterpretationOutput;
