import {
  SERP_QUERY_COOLDOWN_MS,
  detectSerpProviderRejection,
  isSerpQueryCooldownError,
} from './serp-provider-rejection';

describe('detectSerpProviderRejection', () => {
  it('detects failed_query_rejected from body text', () => {
    const body =
      'This query recently failed and cannot be attempted at this time. Please try again later, after a minimum of 15 seconds. https://docs.brightdata.com/scraping-automation/serp-api/debugging#serp-api-erro';
    expect(detectSerpProviderRejection(body)).toEqual({
      code: 'SERP_FAILED_QUERY_REJECTED',
      retryAfterMs: SERP_QUERY_COOLDOWN_MS,
    });
  });

  it('detects repeat_query_rejected from body text', () => {
    const body =
      'This query cannot be attempted at this time. Please try again later, after a minimum of 15 seconds.';
    expect(detectSerpProviderRejection(body)?.code).toBe(
      'SERP_REPEAT_QUERY_REJECTED',
    );
  });

  it('prefers x-brd-error-code header', () => {
    const headers = {
      get: (name: string) =>
        name.toLowerCase() === 'x-brd-error-code'
          ? 'failed_query_rejected'
          : null,
    };
    expect(detectSerpProviderRejection('ignored', headers)).toEqual({
      code: 'SERP_FAILED_QUERY_REJECTED',
      retryAfterMs: SERP_QUERY_COOLDOWN_MS,
      brdErrorCode: 'failed_query_rejected',
    });
  });

  it('returns null for HTML or unrelated text', () => {
    expect(detectSerpProviderRejection('<html><body></body></html>')).toBeNull();
    expect(detectSerpProviderRejection('not-html-plain-error')).toBeNull();
    expect(detectSerpProviderRejection('')).toBeNull();
  });

  it('isSerpQueryCooldownError', () => {
    expect(isSerpQueryCooldownError('SERP_FAILED_QUERY_REJECTED')).toBe(true);
    expect(isSerpQueryCooldownError('SERP_RESPONSE_NOT_HTML')).toBe(false);
  });
});
