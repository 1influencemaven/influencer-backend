import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global rate limit for writes only (login, searches that spend Bright Data /
 * LLM, mutations). Reads are skipped: the frontend polls several GET endpoints
 * every 2.5 s while runs are PROCESSING, and every user reaches Nest through the
 * Next.js proxy (same IP), so one open page exhausted THROTTLE_LIMIT and the UI
 * got HTTP 429. Reads still require auth on their own guards.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest<Request>();
      if (READ_METHODS.has(request.method?.toUpperCase())) return true;
    }
    return super.shouldSkip(context);
  }
}
