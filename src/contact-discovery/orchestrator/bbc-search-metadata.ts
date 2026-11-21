/** Failure categories for page-level Unlocker / fetch diagnostics (metadata only). */
export type UnlockerProviderFailureKind =
  | 'transport'
  | 'http'
  | 'empty_body'
  | 'malformed';

/** Business outcome for COMPLETED BBC / Mastra contact runs (ADR-0020). */
export type BbcRunOutcome = 'RESULTS_FOUND' | 'NO_MATCHES' | 'PROVIDER_FAILURE';

export type BbcPageAttemptResult = {
  url: string;
  outcome: string;
  apiHttpStatus: number;
  bodyLength: number;
  /**
   * Per-page Unlocker duration when actually measured.
   * RF-04.1: omit when unknown — never invent `0` as a placeholder.
   */
  elapsedMs?: number;
  zone: string;
  providerFailureKind: UnlockerProviderFailureKind | null;
  errorName?: string;
  errorMessage?: string;
  causeCode?: string;
};

export type BbcSearchMetadataV2 = {
  schemaVersion: 2;
  providerId: 'bbc-brightdata';
  outcome: BbcRunOutcome;
  providerFailureKind?: UnlockerProviderFailureKind;
  errorSummary?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  businessContacts: {
    created: number;
    updated: number;
    emailsFound: number;
    pagesAttempted: number;
    pagesSucceeded: number;
    pagesFailed: number;
    failureCountsByCategory: Record<string, number>;
    discardCountsByReason: Record<string, number>;
    pageResults: BbcPageAttemptResult[];
  };
};

export function resolveBbcRunOutcome(args: {
  contactsPersisted: number;
  pageResults: BbcPageAttemptResult[];
}): BbcRunOutcome {
  if (args.contactsPersisted > 0) {
    return 'RESULTS_FOUND';
  }

  const hasProviderFailure = args.pageResults.some(
    (page) => page.providerFailureKind !== null,
  );
  if (hasProviderFailure) {
    return 'PROVIDER_FAILURE';
  }

  const hasUsableProviderResponse = args.pageResults.some(
    (page) => page.outcome === 'ok',
  );
  if (hasUsableProviderResponse) {
    return 'NO_MATCHES';
  }

  // No usable content and no explicit failure kinds (e.g. zero pages).
  return 'PROVIDER_FAILURE';
}

export function pickPrimaryProviderFailureKind(
  pageResults: BbcPageAttemptResult[],
): UnlockerProviderFailureKind | undefined {
  const order: UnlockerProviderFailureKind[] = [
    'transport',
    'http',
    'empty_body',
    'malformed',
  ];
  for (const kind of order) {
    if (pageResults.some((p) => p.providerFailureKind === kind)) {
      return kind;
    }
  }
  return undefined;
}
