import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BrightDataDatasetClient } from './brightdata-dataset.client';
import { BrightDataSearchClient } from './brightdata-search.client';

/**
 * Shared Nest DI for Bright Data HTTP clients (SERP + Unlocker + Datasets).
 * Pure utils (`unlocker-fetch.util`, `url-domain.util`) remain functions (no providers).
 *
 * BD-01.g — singleton Search client for Brand / Lead / Contact.
 * Dataset client used by Talent Manager Instagram research (HU-TM-003).
 */
@Module({
  imports: [ConfigModule],
  providers: [BrightDataSearchClient, BrightDataDatasetClient],
  exports: [BrightDataSearchClient, BrightDataDatasetClient],
})
export class BrightDataModule {}
