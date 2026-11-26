import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { AiExecutionModule } from './ai-execution/ai-execution.module';
import { BullMqModule } from './bullmq/bullmq.module';
import { databaseConfig } from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import { jwtConfig } from './config/jwt.config';
import { throttlerConfig } from './config/throttler.config';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';

import { LoggerModule } from './common/logger/logger.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';
import { InfluencersModule } from './influencers/influencers.module';
import { IdealBrandProfilesModule } from './ideal-brand-profiles/ideal-brand-profiles.module';
import { AiPromptsModule } from './ai-prompts/ai-prompts.module';
import { BrandDiscoveryModule } from './brand-discovery/brand-discovery.module';
import { ContactDiscoveryModule } from './contact-discovery/contact-discovery.module';
import { LeadDiscoveryModule } from './lead-discovery/lead-discovery.module';
import { EmailAccountsModule } from './email-accounts/email-accounts.module';
import { FieldsModule } from './fields/fields.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: true,
        allowUnknown: true,
        convert: true,
      },
    }),

    // Bull root before queue consumers (IBP domain + ai.execution.*)
    BullMqModule,
    AiExecutionModule,

    PrismaModule,
    AuthModule,
    UsersModule,
    InfluencersModule,
    IdealBrandProfilesModule,
    AiPromptsModule,
    BrandDiscoveryModule,
    ContactDiscoveryModule,
    EmailAccountsModule,
    FieldsModule,
    LeadDiscoveryModule,
    LoggerModule,
    HealthModule,
    RedisModule,

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        throttlerConfig(configService),
    }),
  ],

  controllers: [AppController],

  providers: [
    AppService,
    AppThrottlerGuard,
    {
      provide: APP_GUARD,
      useExisting: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}
