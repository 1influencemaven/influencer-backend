import { HttpException, HttpStatus } from '@nestjs/common';

/** Stable error codes returned to the frontend for Saleshandy failures. */
export const SALESHANDY_ERROR_CODES = {
  NOT_CONFIGURED: 'SALESHANDY_NOT_CONFIGURED',
  AUTH_FAILED: 'SALESHANDY_AUTH_FAILED',
  VALIDATION: 'SALESHANDY_VALIDATION_ERROR',
  NOT_FOUND: 'SALESHANDY_NOT_FOUND',
  CONFLICT: 'SALESHANDY_CONFLICT',
  RATE_LIMITED: 'SALESHANDY_RATE_LIMITED',
  UNAVAILABLE: 'SALESHANDY_UNAVAILABLE',
  TIMEOUT: 'SALESHANDY_TIMEOUT',
} as const;

export type SaleshandyErrorCode =
  (typeof SALESHANDY_ERROR_CODES)[keyof typeof SALESHANDY_ERROR_CODES];

/**
 * Saleshandy failure mapped to an HTTP response for our API. Never uses 401:
 * the frontend treats 401 as an expired session and would log the user out.
 */
export class SaleshandyApiException extends HttpException {
  constructor(
    readonly code: SaleshandyErrorCode,
    message: string,
    status: HttpStatus,
    readonly upstreamStatus?: number,
    readonly upstreamCode?: string,
  ) {
    super({ message, code }, status);
  }
}

/**
 * Saleshandy error bodies are often `"1001: Invalid token<br><br>"` (HTML-ish
 * strings) or `{ message: string | string[] }`. Returns a clean message and the
 * numeric Saleshandy code when present.
 */
export function parseSaleshandyErrorBody(body: unknown): {
  message: string;
  upstreamCode?: string;
} {
  let raw = '';
  if (typeof body === 'string') {
    raw = body;
  } else if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.error;
    if (Array.isArray(message)) raw = message.map(String).join('; ');
    else if (typeof message === 'string') raw = message;
  }
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = text.match(/^(\d{3,5})\s*:\s*(.+)$/);
  if (match) return { upstreamCode: match[1], message: match[2].trim() };
  return { message: text };
}

/** Maps an upstream HTTP status (+ Saleshandy code) to our error contract. */
export function toSaleshandyException(
  status: number,
  body: unknown,
): SaleshandyApiException {
  const { message, upstreamCode } = parseSaleshandyErrorBody(body);
  const fallback = message || `Saleshandy request failed (HTTP ${status})`;

  // Saleshandy reuses code 1001 (e.g. 409 "Email account already exists"), so
  // an auth failure is 401/403 or a message about the token / API key.
  const authMessage = /invalid token|api[\s-]?key|unauthori[sz]ed|forbidden/i.test(message);
  if (status === 401 || status === 403 || (status < 500 && status !== 409 && authMessage)) {
    return new SaleshandyApiException(
      SALESHANDY_ERROR_CODES.AUTH_FAILED,
      'Saleshandy rejected the API key. Check SALESHANDY_API_KEY.',
      HttpStatus.BAD_GATEWAY,
      status,
      upstreamCode,
    );
  }
  if (status === 404) {
    return new SaleshandyApiException(
      SALESHANDY_ERROR_CODES.NOT_FOUND,
      fallback,
      HttpStatus.NOT_FOUND,
      status,
      upstreamCode,
    );
  }
  if (status === 409) {
    return new SaleshandyApiException(
      SALESHANDY_ERROR_CODES.CONFLICT,
      fallback,
      HttpStatus.CONFLICT,
      status,
      upstreamCode,
    );
  }
  if (status === 413 || status === 422 || (status >= 400 && status < 429)) {
    return new SaleshandyApiException(
      SALESHANDY_ERROR_CODES.VALIDATION,
      fallback,
      HttpStatus.BAD_REQUEST,
      status,
      upstreamCode,
    );
  }
  if (status === 429) {
    return new SaleshandyApiException(
      SALESHANDY_ERROR_CODES.RATE_LIMITED,
      'Saleshandy rate limit reached. Try again in a moment.',
      HttpStatus.TOO_MANY_REQUESTS,
      status,
      upstreamCode,
    );
  }
  return new SaleshandyApiException(
    SALESHANDY_ERROR_CODES.UNAVAILABLE,
    'Saleshandy is unavailable right now. Try again later.',
    HttpStatus.BAD_GATEWAY,
    status,
    upstreamCode,
  );
}
