import { Module } from '@nestjs/common';

import { InfluencerAccessService } from './influencer-access.service';

/** Lightweight module (no queues) so Templates/Prospects can check talent access. */
@Module({
  providers: [InfluencerAccessService],
  exports: [InfluencerAccessService],
})
export class InfluencerAccessModule {}
