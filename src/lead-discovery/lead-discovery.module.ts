import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { AiModule } from '../ai/ai.module';
import { AiPromptsModule } from '../ai-prompts/ai-prompts.module';
import { AuthModule } from '../auth/auth.module';
import { QUEUES } from '../bullmq/queue.constants';
import { AiService } from '../ai/ai.service';
import { BrightDataClient } from './clients/brightdata.client';
import { BrightDataSearchClient } from './clients/brightdata-search.client';
import { LeadDiscoveryController } from './lead-discovery.controller';
import { LeadDiscoveryService } from './lead-discovery.service';
import { ContactChannelService } from './contact-channel.service';
import { BrandBusinessContactService } from './brand-business-contact.service';
import { BrandBusinessContactDiscoveryService } from './brand-business-contact-discovery.service';
import {
  hasConfiguredApiKey,
  LeadSourceRegistry,
} from './lead-source.registry';
import type { LeadSourceProvider } from './interfaces/lead-source-provider.interface';
import {
  AI_BRIGHTDATA_PROVIDER_ID,
  AiPlusBrightDataLeadSource,
} from './providers/ai-plus-brightdata.lead-source';
import { BrightDataLeadSource } from './providers/brightdata.lead-source';
import { MockAiPlusBrightDataLeadSource } from './providers/mock-ai-plus-brightdata.lead-source';
import { MockLeadSource } from './providers/mock.lead-source';
import { LeadDiscoverySearchOrchestrator } from './search/lead-discovery-search.orchestrator';
import { PublicEmailEvidenceDiscoveryService } from './email-discovery/public-email-evidence-discovery.service';
import { UnlockerDiagnosticsService } from './unlocker-diagnostics.service';

@Module({
  imports: [
    AuthModule,
    ConfigModule,
    AiModule,
    AiPromptsModule,
    BullModule.registerQueue({ name: QUEUES.PROSPECTING }),
  ],
  controllers: [LeadDiscoveryController],
  providers: [
    LeadDiscoveryService,
    ContactChannelService,
    BrandBusinessContactService,
    BrandBusinessContactDiscoveryService,
    UnlockerDiagnosticsService,
    BrightDataClient,
    BrightDataSearchClient,
    LeadDiscoverySearchOrchestrator,
    PublicEmailEvidenceDiscoveryService,
    {
      provide: LeadSourceRegistry,
      inject: [
        ConfigService,
        BrightDataClient,
        AiService,
        LeadDiscoverySearchOrchestrator,
      ],
      useFactory: (
        configService: ConfigService,
        brightDataClient: BrightDataClient,
        aiService: AiService,
        searchOrchestrator: LeadDiscoverySearchOrchestrator,
      ) => {
        const providers = new Map<string, LeadSourceProvider>();

        if (configService.get<string>('NODE_ENV') === 'test') {
          providers.set(
            AI_BRIGHTDATA_PROVIDER_ID,
            new MockAiPlusBrightDataLeadSource(),
          );
          providers.set('brightdata', new MockLeadSource());
          return new LeadSourceRegistry(providers, configService);
        }

        if (hasConfiguredApiKey(configService, 'BRIGHTDATA_API_KEY')) {
          providers.set(
            AI_BRIGHTDATA_PROVIDER_ID,
            new AiPlusBrightDataLeadSource(
              brightDataClient,
              configService,
              aiService,
              searchOrchestrator,
            ),
          );
          providers.set(
            'brightdata',
            new BrightDataLeadSource(
              brightDataClient,
              configService,
              searchOrchestrator,
            ),
          );
        }

        return new LeadSourceRegistry(providers, configService);
      },
    },
  ],
  exports: [LeadDiscoveryService],
})
export class LeadDiscoveryModule {}
