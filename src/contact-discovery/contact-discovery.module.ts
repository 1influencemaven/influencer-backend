import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { AiModule } from '../ai/ai.module';
import { QUEUES } from '../bullmq/queue.constants';
import { BrightDataSearchClient } from '../integrations/brightdata';
import { BrandBusinessContactService } from '../lead-discovery/brand-business-contact.service';
import { ContactDiscoveryService } from './contact-discovery.service';
import { AiContactResearchOrchestrator } from './orchestrator/ai-contact-research.orchestrator';
import { BbcDiscoveryOrchestrator } from './orchestrator/bbc-discovery.orchestrator';
import { BrightDataUnlockerAdapter } from './port/bright-data-unlocker.adapter';
import { BRIGHT_DATA_UNLOCKER_PORT } from './port/bright-data-unlocker.port';
import { ContactDiscoveryProcessor } from './processors/contact-discovery.processor';

/**
 * Contact Discovery BBC v1 (ADR-0020) + AI research orchestrator (demo).
 * Isolated from Brand Discovery domain — shares only `integrations/brightdata`.
 * Queue: `contact-discovery` (never `prospecting`).
 */
@Module({
  imports: [
    ConfigModule,
    AiModule,
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
    BrightDataSearchClient,
    BrightDataUnlockerAdapter,
    {
      provide: BRIGHT_DATA_UNLOCKER_PORT,
      useExisting: BrightDataUnlockerAdapter,
    },
    BrandBusinessContactService,
    BbcDiscoveryOrchestrator,
    AiContactResearchOrchestrator,
    ContactDiscoveryService,
    ContactDiscoveryProcessor,
  ],
  exports: [ContactDiscoveryService],
})
export class ContactDiscoveryModule {}
