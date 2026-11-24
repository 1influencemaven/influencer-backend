import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { AgencyDiscoveryModule } from '../agency-discovery/agency-discovery.module';
import { AiExecutionModule } from '../ai-execution/ai-execution.module';
import { QUEUES } from '../bullmq/queue.constants';
import { BrandBusinessContactService } from '../lead-discovery/brand-business-contact.service';
import { ContactChannelService } from '../lead-discovery/contact-channel.service';
import { ContactDiscoveryService } from './contact-discovery.service';
import { ContactEmailMastraOrchestrator } from './orchestrator/contact-email-mastra.orchestrator';
import { ContactDiscoveryProcessor } from './processors/contact-discovery.processor';
import { SaleshandyClient } from '../integrations/saleshandy/saleshandy.client';
import { SaleshandyEnrichmentService } from './saleshandy/saleshandy-enrichment.service';

/**
 * Contact Discovery: Mastra 2A + conditional 2B + always-on Agency Discovery (2C).
 * Queue: `contact-discovery` (never `prospecting` / find-brands). No separate 2C queue.
 */
@Module({
  imports: [
    ConfigModule,
    AiExecutionModule,
    AgencyDiscoveryModule,
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
    ContactChannelService,
    SaleshandyClient,
    SaleshandyEnrichmentService,
    ContactEmailMastraOrchestrator,
    ContactDiscoveryService,
    ContactDiscoveryProcessor,
  ],
  exports: [ContactDiscoveryService],
})
export class ContactDiscoveryModule {}
