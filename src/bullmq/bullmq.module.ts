import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow('REDIS_HOST'),
          port: Number(configService.getOrThrow('REDIS_PORT')),
          password: configService.get('REDIS_PASSWORD') || undefined,
          db: Number(configService.getOrThrow('REDIS_DB')),
        },
      }),
    }),
  ],
})
export class BullMqModule {}
