import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { AuthModule } from '../auth/auth.module';
import { QUEUES } from '../bullmq/queue.constants';
import { BrightDataModule } from '../integrations/brightdata';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';
import { InstagramResearchService } from './instagram-research.service';
import { InstagramResearchProcessor } from './processors/instagram-research.processor';

@Module({
  imports: [
    AuthModule,
    BrightDataModule,
    BullModule.registerQueue({
      name: QUEUES.INSTAGRAM_RESEARCH,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
  ],
  controllers: [InfluencersController],
  providers: [
    InfluencersService,
    InstagramResearchService,
    InstagramResearchProcessor,
  ],
  exports: [InfluencersService],
})
export class InfluencersModule {}
