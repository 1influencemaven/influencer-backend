import { Module } from '@nestjs/common';

import { SaleshandyModule } from '../integrations/saleshandy/saleshandy.module';
import { FieldsSyncService } from './fields-sync.service';
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';

/** HU-FLD-001..005: Saleshandy prospect fields catalog. */
@Module({
  imports: [SaleshandyModule],
  controllers: [FieldsController],
  providers: [FieldsService, FieldsSyncService],
  exports: [FieldsService],
})
export class FieldsModule {}
