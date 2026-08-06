import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { AiModule } from '../ai/ai.module';
import { AiPromptsModule } from '../ai-prompts/ai-prompts.module';
import { AuthModule } from '../auth/auth.module';
import { QUEUES } from '../bullmq/queue.constants';
import { BrightDataClient } from './clients/brightdata.client';
import { LeadDiscoveryController } from './lead-discovery.controller';
import { LeadDiscoveryService } from './lead-discovery.service';
import {
  hasConfiguredApiKey,
  LeadSourceRegistry,
} from './lead-source.registry';
import type { LeadSourceProvider } from './interfaces/lead-source-provider.interface';
import { AiService } from '../ai/ai.service';
import {
  AI_BRIGHTDATA_PROVIDER_ID,
  AiPlusBrightDataLeadSource,
} from './providers/ai-plus-brightdata.lead-source';
import { BrightDataLeadSource } from './providers/brightdata.lead-source';
import { MockAiPlusBrightDataLeadSource } from './providers/mock-ai-plus-brightdata.lead-source';
import { MockLeadSource } from './providers/mock.lead-source';

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
    BrightDataClient,
    {
      provide: LeadSourceRegistry,
      inject: [ConfigService, BrightDataClient, AiService],
      useFactory: (
        configService: ConfigService,
        brightDataClient: BrightDataClient,
        aiService: AiService,
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
            ),
          );
          providers.set(
            'brightdata',
            new BrightDataLeadSource(brightDataClient, configService),
          );
        }

        // Apollo: reserved (ADR-0009). Register when APOLLO_API_KEY + implementation exist.

        return new LeadSourceRegistry(providers, configService);
      },
    },
  ],
  exports: [LeadDiscoveryService],
})
export class LeadDiscoveryModule {}
