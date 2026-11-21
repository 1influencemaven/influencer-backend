import {
  pickPrimaryProviderFailureKind,
  resolveBbcRunOutcome,
  type BbcPageAttemptResult,
} from './bbc-search-metadata';

function page(
  partial: Partial<BbcPageAttemptResult> &
    Pick<BbcPageAttemptResult, 'url' | 'outcome'>,
): BbcPageAttemptResult {
  return {
    apiHttpStatus: 200,
    bodyLength: 10,
    elapsedMs: 1,
    zone: 'mcp_unlocker',
    providerFailureKind: null,
    ...partial,
  };
}

describe('resolveBbcRunOutcome', () => {
  it('RESULTS_FOUND when contacts persisted even if some pages failed', () => {
    expect(
      resolveBbcRunOutcome({
        contactsPersisted: 2,
        pageResults: [
          page({ url: 'https://a/contact', outcome: 'ok' }),
          page({
            url: 'https://a/press',
            outcome: 'empty_body',
            providerFailureKind: 'empty_body',
            bodyLength: 0,
          }),
        ],
      }),
    ).toBe('RESULTS_FOUND');
  });

  it('NO_MATCHES only when all attempts usable and zero contacts', () => {
    expect(
      resolveBbcRunOutcome({
        contactsPersisted: 0,
        pageResults: [
          page({ url: 'https://a/contact', outcome: 'ok', bodyLength: 100 }),
          page({ url: 'https://a/about', outcome: 'ok', bodyLength: 80 }),
        ],
      }),
    ).toBe('NO_MATCHES');
  });

  it('PROVIDER_FAILURE when any empty_body and zero contacts', () => {
    expect(
      resolveBbcRunOutcome({
        contactsPersisted: 0,
        pageResults: [
          page({ url: 'https://a/contact', outcome: 'ok' }),
          page({
            url: 'https://a/press',
            outcome: 'empty_body',
            providerFailureKind: 'empty_body',
            bodyLength: 0,
          }),
        ],
      }),
    ).toBe('PROVIDER_FAILURE');
  });

  it('PROVIDER_FAILURE for transport/http with zero contacts', () => {
    expect(
      resolveBbcRunOutcome({
        contactsPersisted: 0,
        pageResults: [
          page({
            url: 'https://a/contact',
            outcome: 'network_error',
            providerFailureKind: 'transport',
            apiHttpStatus: 0,
            bodyLength: 0,
          }),
        ],
      }),
    ).toBe('PROVIDER_FAILURE');
  });

  it('picks primary failure kind by severity order', () => {
    expect(
      pickPrimaryProviderFailureKind([
        page({
          url: 'https://a/1',
          outcome: 'empty_body',
          providerFailureKind: 'empty_body',
        }),
        page({
          url: 'https://a/2',
          outcome: 'network_error',
          providerFailureKind: 'transport',
        }),
      ]),
    ).toBe('transport');
  });
});
