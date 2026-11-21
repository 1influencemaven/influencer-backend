import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { AiExecutionResult } from '@influence-maven/ai-contracts';
import { Queue } from 'bullmq';

import { AI_EXECUTION_QUEUES } from './ai-execution.queues';
import {
  waitForAiExecutionResult,
  type WaitForAiExecutionResultOptions,
} from './wait-for-ai-execution-result';

/**
 * Nest injectable facade over {@link waitForAiExecutionResult}.
 * Used by Brand Discovery dual-call orchestration; IBP keeps ResultProcessor.
 */
@Injectable()
export class AiExecutionResultWaitService {
  constructor(
    @InjectQueue(AI_EXECUTION_QUEUES.RESULTS)
    private readonly resultsQueue: Queue,
  ) {}

  waitForAiExecutionResult(
    executionId: string,
    timeoutMs: number,
    options?: WaitForAiExecutionResultOptions,
  ): Promise<AiExecutionResult> {
    return waitForAiExecutionResult(
      this.resultsQueue,
      executionId,
      timeoutMs,
      options,
    );
  }
}
