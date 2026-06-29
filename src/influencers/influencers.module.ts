import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { QUEUES } from '../bullmq/queue.constants';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';
import { GenerateInfluencerProfileProcessor } from './processors/generate-influencer-profile.processor';

@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: QUEUES.AI })],
  controllers: [InfluencersController],
  providers: [InfluencersService, GenerateInfluencerProfileProcessor],
})
export class InfluencersModule {}
