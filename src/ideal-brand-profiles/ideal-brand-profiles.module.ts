import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AiPromptsModule } from '../ai-prompts/ai-prompts.module';
import { AuthModule } from '../auth/auth.module';
import { QUEUES } from '../bullmq/queue.constants';
import { IdealBrandProfilesController } from './ideal-brand-profiles.controller';
import { IdealBrandProfilesService } from './ideal-brand-profiles.service';
import { GenerateIdealBrandProfileProcessor } from './processors/generate-ideal-brand-profile.processor';

@Module({
  imports: [
    AuthModule,
    AiModule,
    AiPromptsModule,
    BullModule.registerQueue({ name: QUEUES.AI }),
  ],
  controllers: [IdealBrandProfilesController],
  providers: [IdealBrandProfilesService, GenerateIdealBrandProfileProcessor],
  exports: [IdealBrandProfilesService],
})
export class IdealBrandProfilesModule {}
