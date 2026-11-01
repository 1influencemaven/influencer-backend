import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { parseAiExecutionEvent } from '@influence-maven/ai-contracts';
import { Job } from 'bullmq';

import {
  AI_EXECUTION_JOBS,
  AI_EXECUTION_QUEUES,
} from './ai-execution.queues';

/** Observability only in AI-003.2 — business state comes from results. */
@Processor(AI_EXECUTION_QUEUES.EVENTS)
export class AiExecutionEventProcessor extends WorkerHost {
  private readonly logger = new Logger(AiExecutionEventProcessor.name);

  async process(job: Job): Promise<void> {
    if (job.name !== AI_EXECUTION_JOBS.EVENT) {
      return;
    }

    try {
      const event = parseAiExecutionEvent(job.data);
      this.logger.log(
        JSON.stringify({
          event: 'ai_execution_event',
          name: event.name,
          type: event.type,
          executionId: event.executionId,
          sequence: event.sequence,
          payloadKind: event.payload.kind,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Invalid AiExecutionEvent job ${job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
