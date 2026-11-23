import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BrandKnowledgeController } from './brand-knowledge.controller';
import { BrandKnowledgeService } from './brand-knowledge.service';

@Module({
  imports: [AuthModule],
  controllers: [BrandKnowledgeController],
  providers: [BrandKnowledgeService],
  exports: [BrandKnowledgeService],
})
export class BrandKnowledgeModule {}
