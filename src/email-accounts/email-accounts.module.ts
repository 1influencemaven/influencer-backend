import { Module } from '@nestjs/common';

import { SaleshandyModule } from '../integrations/saleshandy/saleshandy.module';
import { EmailAccountsController } from './email-accounts.controller';
import { EmailAccountsService } from './email-accounts.service';

/** HU-EA-000..006: Saleshandy sender mailboxes. */
@Module({
  imports: [SaleshandyModule],
  controllers: [EmailAccountsController],
  providers: [EmailAccountsService],
  exports: [EmailAccountsService],
})
export class EmailAccountsModule {}
