import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AiExecutionBootstrapService } from './ai-execution-bootstrap.service';
import { AiExecutionEventProcessor } from './ai-execution-event.processor';
import { AiExecutionPublisherService } from './ai-execution-publisher.service';
import { AiExecutionResultProcessor } from './ai-execution-result.processor';
import { AI_EXECUTION_QUEUES } from './ai-execution.queues';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: AI_EXECUTION_QUEUES.REQUESTS },
      { name: AI_EXECUTION_QUEUES.RESULTS },
      { name: AI_EXECUTION_QUEUES.EVENTS },
    ),
  ],
  providers: [
    AiExecutionPublisherService,
    AiExecutionResultProcessor,
    AiExecutionEventProcessor,
    AiExecutionBootstrapService,
  ],
  exports: [AiExecutionPublisherService],
})
export class AiExecutionModule {}
