import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { AiModule } from '../ai/ai.module';
import { AiService } from '../ai/ai.service';
import { AiExecutionModule } from '../ai-execution/ai-execution.module';
import { AiPromptsModule } from '../ai-prompts/ai-prompts.module';
import { AuthModule } from '../auth/auth.module';
import { QUEUES } from '../bullmq/queue.constants';
import { BrightDataModule } from '../integrations/brightdata';
import { BrandDiscoveryAiOrchestrator } from './brand-discovery-ai.orchestrator';
import { BrandDiscoveryController } from './brand-discovery.controller';
import { BrandDiscoveryResearchService } from './brand-discovery-research.service';
import { BrandDiscoveryService } from './brand-discovery.service';
import {
  BrandSourceRegistry,
  hasConfiguredApiKey,
  type BrandSourceId,
} from './brand-source.registry';
import type { BrandSourceProvider } from './interfaces/brand-source-provider.interface';
import { FindBrandsProcessor } from './processors/find-brands.processor';
import { AiPlusTavilyBrandSource } from './providers/ai-plus-tavily.brand-source';
import { BrightDataWebSearchProvider } from './providers/brightdata-web-search.provider';
import { MockBrandSource } from './providers/mock.brand-source';

@Module({
  imports: [
    AuthModule,
    AiModule,
    AiExecutionModule,
    AiPromptsModule,
    BrightDataModule,
    ConfigModule,
    BullModule.registerQueue({ name: QUEUES.PROSPECTING }),
  ],
  controllers: [BrandDiscoveryController],
  providers: [
    BrandDiscoveryService,
    BrandDiscoveryResearchService,
    FindBrandsProcessor,
    BrightDataWebSearchProvider,
    BrandDiscoveryAiOrchestrator,
    {
      provide: BrandSourceRegistry,
      inject: [ConfigService, AiService, BrightDataWebSearchProvider],
      useFactory: (
        configService: ConfigService,
        aiService: AiService,
        webSearch: BrightDataWebSearchProvider,
      ) => {
        const providers = new Map<BrandSourceId, BrandSourceProvider>();

        if (configService.get<string>('NODE_ENV') === 'test') {
          providers.set('brightdata', new MockBrandSource());
          return new BrandSourceRegistry(providers, configService);
        }

        if (!hasConfiguredApiKey(configService, 'BRIGHTDATA_API_KEY')) {
          return new BrandSourceRegistry(providers, configService);
        }

        providers.set(
          'brightdata',
          new AiPlusTavilyBrandSource(webSearch, aiService, configService),
        );

        return new BrandSourceRegistry(providers, configService);
      },
    },
  ],
  exports: [BrandDiscoveryService, BrandDiscoveryAiOrchestrator],
})
export class BrandDiscoveryModule {}
