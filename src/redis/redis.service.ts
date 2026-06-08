import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.getOrThrow('REDIS_HOST'),
      port: Number(this.configService.getOrThrow('REDIS_PORT')),
      password: this.configService.get('REDIS_PASSWORD') || undefined,
      db: Number(this.configService.getOrThrow('REDIS_DB')),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.ping();

    this.logger.log('Redis connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();

    this.logger.log('Redis connection closed');
  }

  getClient(): Redis {
    return this.client;
  }
}
