import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { BrightDataModule } from '../integrations/brightdata';
import { ContactDiscoveryModule } from '../contact-discovery/contact-discovery.module';
import { LeadDiscoveryController } from './lead-discovery.controller';
import { LeadDiscoveryService } from './lead-discovery.service';
import { ContactChannelService } from './contact-channel.service';
import { BrandBusinessContactService } from './brand-business-contact.service';
import { UnlockerDiagnosticsService } from './unlocker-diagnostics.service';

/**
 * Lead Discovery facade (Paso 5b):
 * - Write: Contact Discovery Mastra via ContactDiscoveryModule
 * - Read: historical Leads + BrandBusinessContact + Unlocker diagnostics
 */
@Module({
  imports: [
    AuthModule,
    ConfigModule,
    BrightDataModule,
    ContactDiscoveryModule,
  ],
  controllers: [LeadDiscoveryController],
  providers: [
    LeadDiscoveryService,
    ContactChannelService,
    BrandBusinessContactService,
    UnlockerDiagnosticsService,
  ],
  exports: [LeadDiscoveryService],
})
export class LeadDiscoveryModule {}
