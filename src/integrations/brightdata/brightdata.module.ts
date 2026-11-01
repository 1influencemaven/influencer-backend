import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BrightDataSearchClient } from './brightdata-search.client';

/**
 * Shared Nest DI for Bright Data HTTP client (SERP + Unlocker).
 * Datasets/scrapers (`BrightDataClient`) stay in Lead Discovery — Lead-only.
 * Pure utils (`unlocker-fetch.util`, `url-domain.util`) remain functions (no providers).
 *
 * BD-01.g — single singleton instance for Brand / Lead / Contact consumers.
 */
@Module({
  imports: [ConfigModule],
  providers: [BrightDataSearchClient],
  exports: [BrightDataSearchClient],
})
export class BrightDataModule {}
