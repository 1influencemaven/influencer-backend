import { Module } from '@nestjs/common';

import { InfluencerAccessModule } from '../influencers/access/influencer-access.module';
import { ProspectsCsvService } from './prospects-csv.service';
import { ProspectsIngestionService } from './prospects-ingestion.service';
import { ProspectsController } from './prospects.controller';
import { ProspectsService } from './prospects.service';

/** Prospects per talent: approved discovered contacts + CSV imports (prerequisite of Templates). */
@Module({
  imports: [InfluencerAccessModule],
  controllers: [ProspectsController],
  providers: [ProspectsService, ProspectsIngestionService, ProspectsCsvService],
  exports: [ProspectsIngestionService, ProspectsService],
})
export class ProspectsModule {}
