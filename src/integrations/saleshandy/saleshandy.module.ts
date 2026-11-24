import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { SaleshandyHttpService } from './saleshandy-http.service';
import { SaleshandyClient } from './saleshandy.client';

/**
 * Shared Saleshandy integration (HU-EA-000). `SaleshandyHttpService` is the
 * only place that talks to the Open API; `SaleshandyClient` keeps the Lead
 * Finder / enrichment helpers behind SALESHANDY_ENRICHMENT_ENABLED.
 */
@Module({
  imports: [ConfigModule],
  providers: [SaleshandyHttpService, SaleshandyClient],
  exports: [SaleshandyHttpService, SaleshandyClient],
})
export class SaleshandyModule {}
