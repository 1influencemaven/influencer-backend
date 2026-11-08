import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { AiExecutionModule } from '../ai-execution/ai-execution.module';
import { QUEUES } from '../bullmq/queue.constants';
import { BrandBusinessContactService } from '../lead-discovery/brand-business-contact.service';
import { ContactDiscoveryService } from './contact-discovery.service';
import { ContactEmailMastraOrchestrator } from './orchestrator/contact-email-mastra.orchestrator';
import { ContactDiscoveryProcessor } from './processors/contact-discovery.processor';

/**
 * Contact Discovery (Paso 5b): Mastra FIND_BRAND_EMAILS only.
 * Queue: `contact-discovery` (never `prospecting` / find-brands).
 */
@Module({
  imports: [
    ConfigModule,
    AiExecutionModule,
    BullModule.registerQueue({
      name: QUEUES.CONTACT_DISCOVERY,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
  ],
  providers: [
    BrandBusinessContactService,
    ContactEmailMastraOrchestrator,
    ContactDiscoveryService,
    ContactDiscoveryProcessor,
  ],
  exports: [ContactDiscoveryService],
})
export class ContactDiscoveryModule {}
