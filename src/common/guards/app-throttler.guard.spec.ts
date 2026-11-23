import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { AppThrottlerGuard } from './app-throttler.guard';

function httpContext(method: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ method }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('AppThrottlerGuard', () => {
  const guard = new AppThrottlerGuard(
    [{ ttl: 60_000, limit: 1 }],
    {} as ThrottlerStorage,
    new Reflector(),
  );
  const shouldSkip = (method: string) =>
    (guard as unknown as { shouldSkip(c: ExecutionContext): Promise<boolean> })
      .shouldSkip(httpContext(method));

  it('skips reads (polling endpoints)', async () => {
    await expect(shouldSkip('GET')).resolves.toBe(true);
    await expect(shouldSkip('HEAD')).resolves.toBe(true);
  });

  it('still throttles writes', async () => {
    await expect(shouldSkip('POST')).resolves.toBe(false);
    await expect(shouldSkip('PATCH')).resolves.toBe(false);
  });
});
