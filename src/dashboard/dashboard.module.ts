import { Module } from '@nestjs/common';

import { EmailAccountsModule } from '../email-accounts/email-accounts.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [EmailAccountsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}