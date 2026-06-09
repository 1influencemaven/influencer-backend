import { ConfigService } from '@nestjs/config';

export const throttlerConfig = (configService: ConfigService) => ({
  throttlers: [
    {
      ttl: Number(configService.getOrThrow('THROTTLE_TTL')),
      limit: Number(configService.getOrThrow('THROTTLE_LIMIT')),
    },
  ],
});
