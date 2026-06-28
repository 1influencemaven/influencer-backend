import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { BullMqModule } from './bullmq/bullmq.module';
import { databaseConfig } from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import { jwtConfig } from './config/jwt.config';
import { throttlerConfig } from './config/throttler.config';

import { LoggerModule } from './common/logger/logger.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: true,
        allowUnknown: true,
      },
    }),

    PrismaModule,
    AuthModule,
    UsersModule,
    LoggerModule,
    HealthModule,
    RedisModule,
    BullMqModule,

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
    ThrottlerGuard,
    {
      provide: APP_GUARD,
      useExisting: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
