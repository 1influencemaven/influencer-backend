import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BrightDataWebSearchProvider } from '../brand-discovery/providers/brightdata-web-search.provider';
import { AiExecutionModule } from '../ai-execution/ai-execution.module';
import { BrightDataModule } from '../integrations/brightdata';
import { PrismaModule } from '../prisma/prisma.module';
import { AgencyContactCommercialReaderService } from './agency-contact-commercial-reader.service';
import { AgencyContactEmailsResearchService } from './agency-contact-emails-research.service';
import { AgencyContactPeopleResearchService } from './agency-contact-people-research.service';
import { AgencyContactPersistenceService } from './agency-contact-persistence.service';
import { AgencyDiscoveryService } from './agency-discovery.service';
import { AgencyPersistenceService } from './agency-persistence.service';

/**
 * Track 2C — Agency Discovery + Agency Contact Research (2C.4.3 / 2C.4.5 / 2C.4.6)
 * + commercial read adapter (2C.4.7).
 * Reuses BrightDataWebSearchProvider + CONTACT_RESEARCH publish/wait (no new queues).
 */
@Module({
  imports: [PrismaModule, BrightDataModule, AiExecutionModule, ConfigModule],
  providers: [
    BrightDataWebSearchProvider,
    AgencyDiscoveryService,
    AgencyPersistenceService,
    AgencyContactPersistenceService,
    AgencyContactEmailsResearchService,
    AgencyContactPeopleResearchService,
    AgencyContactCommercialReaderService,
  ],
  exports: [
    AgencyDiscoveryService,
    AgencyPersistenceService,
    AgencyContactPersistenceService,
    AgencyContactEmailsResearchService,
    AgencyContactPeopleResearchService,
    AgencyContactCommercialReaderService,
  ],
})
export class AgencyDiscoveryModule {}
