import { Module } from '@nestjs/common';

import { InfluencerAccessModule } from '../influencers/access/influencer-access.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** HU-TPL-001..011: local email templates with stable variables. */
@Module({
  imports: [InfluencerAccessModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
