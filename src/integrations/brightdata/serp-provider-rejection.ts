/** Bright Data bans a failed/repeated query string for at least 15s (per zone). */
export const SERP_QUERY_COOLDOWN_MS = 15_000;

export type SerpProviderRejectionCode =
  | 'SERP_FAILED_QUERY_REJECTED'
  | 'SERP_REPEAT_QUERY_REJECTED';

export type SerpProviderRejection = {
  code: SerpProviderRejectionCode;
  retryAfterMs: number;
  brdErrorCode?: string;
};

type HeaderReader = { get(name: string): string | null };

/**
 * Detects Bright Data SERP soft-rejections delivered as HTTP 200 plain text
 * and/or `x-brd-error-code` (failed_query_rejected / repeat_query_rejected).
 */
export function detectSerpProviderRejection(
  body: string,
  headers?: HeaderReader | null,
): SerpProviderRejection | null {
  const headerCode = (
    headers?.get('x-brd-error-code') ??
    headers?.get('x-brd-err-code') ??
    ''
  )
    .trim()
    .toLowerCase();

  if (headerCode === 'failed_query_rejected') {
    return {
      code: 'SERP_FAILED_QUERY_REJECTED',
      retryAfterMs: SERP_QUERY_COOLDOWN_MS,
      brdErrorCode: headerCode,
    };
  }
  if (headerCode === 'repeat_query_rejected') {
    return {
      code: 'SERP_REPEAT_QUERY_REJECTED',
      retryAfterMs: SERP_QUERY_COOLDOWN_MS,
      brdErrorCode: headerCode,
    };
  }

  const text = body.trim();
  if (!text) {
    return null;
  }

  if (/recently failed and cannot be attempted/i.test(text)) {
    return {
      code: 'SERP_FAILED_QUERY_REJECTED',
      retryAfterMs: SERP_QUERY_COOLDOWN_MS,
    };
  }

  if (
    /this query cannot be attempted at this time/i.test(text) &&
    /15 seconds/i.test(text)
  ) {
    return {
      code: 'SERP_REPEAT_QUERY_REJECTED',
      retryAfterMs: SERP_QUERY_COOLDOWN_MS,
    };
  }

  return null;
}

export function isSerpQueryCooldownError(parseError?: string): boolean {
  return (
    parseError === 'SERP_FAILED_QUERY_REJECTED' ||
    parseError === 'SERP_REPEAT_QUERY_REJECTED'
  );
}
