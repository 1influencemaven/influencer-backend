import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';

import { RedisService } from '../redis/redis.service';

export type RedisPingCheckSettings = {
  timeout?: number;
};

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redisService: RedisService,
  ) {}

  async pingCheck<Key extends string = string>(
    key: Key,
    options: RedisPingCheckSettings = {},
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);
    const timeout = options.timeout ?? 1000;

    try {
      await Promise.race([
        this.redisService.getClient().ping(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`timeout of ${timeout}ms exceeded`)),
            timeout,
          ),
        ),
      ]);
    } catch (error) {
      if (error instanceof Error) {
        return check.down(error.message);
      }

      return check.down();
    }

    return check.up();
  }
}
