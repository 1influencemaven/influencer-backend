import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { AiExecutionEventProcessor } from './ai-execution-event.processor';
import { AiExecutionResultProcessor } from './ai-execution-result.processor';
import { AI_EXECUTION_QUEUES } from './ai-execution.queues';

@Injectable()
export class AiExecutionBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AiExecutionBootstrap');

  constructor(private readonly moduleRef: ModuleRef) {}

  onApplicationBootstrap(): void {
    this.logger.log(
      'IBP execution path: AiExecutionPublisher → ai.execution.requests (Mastra). Ensure influencer-ai worker is running.',
    );
    this.logWorker(
      'results',
      AI_EXECUTION_QUEUES.RESULTS,
      AiExecutionResultProcessor,
    );
    this.logWorker(
      'events',
      AI_EXECUTION_QUEUES.EVENTS,
      AiExecutionEventProcessor,
    );
  }

  private logWorker(
    label: string,
    queueName: string,

    ProcessorClass: any,
  ): void {
    try {
      const processor = this.moduleRef.get(ProcessorClass, {
        strict: false,
      });
      let running = false;
      try {
        running =
          typeof processor.worker?.isRunning === 'function'
            ? processor.worker.isRunning()
            : false;
      } catch {
        running = false;
      }
      this.logger.log(
        `BullMQ consumer ${label} queue=${queueName} registered=${Boolean(processor)} running=${running}`,
      );
    } catch (error) {
      this.logger.error(
        `BullMQ consumer ${label} queue=${queueName} NOT registered: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
