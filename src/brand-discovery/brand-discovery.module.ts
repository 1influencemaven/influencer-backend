import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { AiModule } from '../ai/ai.module';
import { AiService } from '../ai/ai.service';
import { AiPromptsModule } from '../ai-prompts/ai-prompts.module';
import { AuthModule } from '../auth/auth.module';
import { QUEUES } from '../bullmq/queue.constants';
import { BrandDiscoveryController } from './brand-discovery.controller';
import { BrandDiscoveryService } from './brand-discovery.service';
import {
  BrandSourceRegistry,
  hasConfiguredApiKey,
  type BrandSourceId,
} from './brand-source.registry';
import type { BrandSourceProvider } from './interfaces/brand-source-provider.interface';
import { FindBrandsProcessor } from './processors/find-brands.processor';
import { AiPlusTavilyBrandSource } from './providers/ai-plus-tavily.brand-source';
import { MockBrandSource } from './providers/mock.brand-source';
import { TavilyWebSearchProvider } from './providers/tavily-web-search.provider';

@Module({
  imports: [
    AuthModule,
    AiModule,
    AiPromptsModule,
    ConfigModule,
    BullModule.registerQueue({ name: QUEUES.PROSPECTING }),
  ],
  controllers: [BrandDiscoveryController],
  providers: [
    BrandDiscoveryService,
    FindBrandsProcessor,
    {
      provide: BrandSourceRegistry,
      inject: [ConfigService, AiService],
      useFactory: (configService: ConfigService, aiService: AiService) => {
        const providers = new Map<BrandSourceId, BrandSourceProvider>();

        if (configService.get<string>('NODE_ENV') === 'test') {
          providers.set('tavily', new MockBrandSource());
          return new BrandSourceRegistry(providers, configService);
        }

        if (!hasConfiguredApiKey(configService, 'TAVILY_API_KEY')) {
          return new BrandSourceRegistry(providers, configService);
        }

        const webSearch = new TavilyWebSearchProvider(configService);
        providers.set(
          'tavily',
          new AiPlusTavilyBrandSource(webSearch, aiService),
        );

        return new BrandSourceRegistry(providers, configService);
      },
    },
  ],
  exports: [BrandDiscoveryService],
})
export class BrandDiscoveryModule {}
