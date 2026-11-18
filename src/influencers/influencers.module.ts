import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BrightDataModule } from '../integrations/brightdata';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';
import { InstagramResearchService } from './instagram-research.service';

@Module({
  imports: [AuthModule, BrightDataModule],
  controllers: [InfluencersController],
  providers: [InfluencersService, InstagramResearchService],
  exports: [InfluencersService],
})
export class InfluencersModule {}
