import type {
  BusinessContactDiscoverySummary,
  LeadDiscoveryOutcome,
  LeadDiscoveryWarningCode,
  PeopleSearchBrightDataDiagnostics,
  PeopleSearchTavilyDiagnostics,
  PeopleSearchTrace,
} from '../interfaces/lead-source-provider.interface';

export type OutcomeClassificationInput = {
  leadsPersisted: number;
  businessContactsCreated: number;
  businessContactDiscovery?: BusinessContactDiscoverySummary;
  peopleSearchTrace?: PeopleSearchTrace | null;
};

export type OutcomeClassificationResult = {
  outcome: LeadDiscoveryOutcome;
  warningCode: LeadDiscoveryWarningCode | null;
  /** Short English API message — never secrets or personal data. */
  warningMessage: string | null;
};

function isUnlockerTotalFailure(
  summary: BusinessContactDiscoverySummary | undefined,
): boolean {
  return Boolean(
    summary && summary.pagesAttempted > 0 && summary.pagesSucceeded === 0,
  );
}

function isPeopleScraperTotalFailure(
  trace: PeopleSearchTrace | null | undefined,
): boolean {
  if (!trace) {
    return false;
  }
  return (
    trace.selectedProfileUrlsCount > 0 &&
    trace.scraperInvocations > 0 &&
    trace.scraperSuccesses === 0
  );
}

/**
 * Bright Data search exhausted with zero usable hits and no Tavily fallback.
 * Known zeros only — absent trace is not treated as failure.
 */
function isPeopleSearchProviderFailure(
  trace: PeopleSearchTrace | null | undefined,
): boolean {
  if (!trace) {
    return false;
  }
  return (
    trace.brightDataSearchRequests > 0 &&
    trace.brightDataSearchFailures === trace.brightDataSearchRequests &&
    trace.tavilyFallbackRequests === 0 &&
    trace.searchHitsReceived === 0
  );
}

/**
 * Classifies a COMPLETED Lead Discovery run for UI/API consumers.
 * Does not change LeadDiscoveryStatus — polling stays on PROCESSING → COMPLETED|FAILED.
 */
export function classifyLeadDiscoveryOutcome(
  input: OutcomeClassificationInput,
): OutcomeClassificationResult {
  const unlockerFailed = isUnlockerTotalFailure(input.businessContactDiscovery);
  const scraperFailed = isPeopleScraperTotalFailure(input.peopleSearchTrace);
  const searchFailed = isPeopleSearchProviderFailure(input.peopleSearchTrace);

  type AtomicWarningCode = Exclude<
    LeadDiscoveryWarningCode,
    'mixed_provider_failure'
  >;
  const failureFlags: AtomicWarningCode[] = [
    unlockerFailed ? ('unlocker_all_pages_failed' as const) : null,
    scraperFailed ? ('people_scraper_all_failed' as const) : null,
    searchFailed ? ('people_search_provider_failed' as const) : null,
  ].filter((code): code is AtomicWarningCode => code !== null);

  if (failureFlags.length > 0) {
    const warningCode: LeadDiscoveryWarningCode =
      failureFlags.length > 1
        ? 'mixed_provider_failure'
        : failureFlags[0];
    const warningMessage =
      warningCode === 'mixed_provider_failure'
        ? 'One or more lead-discovery providers failed; results may be incomplete.'
        : warningCode === 'unlocker_all_pages_failed'
          ? 'Business-contact Unlocker failed for every attempted page.'
          : warningCode === 'people_scraper_all_failed'
            ? 'People scraper failed for every selected profile URL.'
            : 'People search provider failed with no usable search hits.';

    return {
      outcome: 'PROVIDER_FAILURE',
      warningCode,
      warningMessage,
    };
  }

  const hasResults =
    input.leadsPersisted > 0 || input.businessContactsCreated > 0;

  if (hasResults) {
    return {
      outcome: 'FULL',
      warningCode: null,
      warningMessage: null,
    };
  }

  return {
    outcome: 'EMPTY_LEGITIMATE',
    warningCode: null,
    warningMessage: null,
  };
}

/**
 * Builds a people-search audit trace. All counters are known numbers (0 ≠ unknown).
 * Omit the whole object on legacy / uninstrumented providers.
 */
export function buildPeopleSearchTrace(args: {
  searchHitsReceived: number;
  linkedinUrlValidated: number;
  scoredCandidates: number;
  qualifiedCandidates: number;
  selectedProfileUrls: string[];
  brightDataSearchRequests: number;
  brightDataSearchFailures: number;
  tavilyFallbackRequests: number;
  scraperInvocations: number;
  scraperSuccesses: number;
  scraperFailures: number;
  searchFailureCodes: string[];
  scraperErrorCodes: string[];
  brightDataDiagnostics?: PeopleSearchBrightDataDiagnostics;
  tavilyDiagnostics?: PeopleSearchTavilyDiagnostics;
}): PeopleSearchTrace {
  const selectedProfileUrls = args.selectedProfileUrls.slice(0, 50);
  return {
    searchHitsReceived: args.searchHitsReceived,
    linkedinUrlValidated: args.linkedinUrlValidated,
    scoredCandidates: args.scoredCandidates,
    qualifiedCandidates: args.qualifiedCandidates,
    selectedProfileUrlsCount: selectedProfileUrls.length,
    selectedProfileUrls,
    brightDataSearchRequests: args.brightDataSearchRequests,
    brightDataSearchFailures: args.brightDataSearchFailures,
    tavilyFallbackRequests: args.tavilyFallbackRequests,
    scraperInvocations: args.scraperInvocations,
    scraperSuccesses: args.scraperSuccesses,
    scraperFailures: args.scraperFailures,
    searchFailureCodes: args.searchFailureCodes.slice(0, 20),
    scraperErrorCodes: args.scraperErrorCodes.slice(0, 20),
    ...(args.brightDataDiagnostics
      ? { brightDataDiagnostics: args.brightDataDiagnostics }
      : {}),
    ...(args.tavilyDiagnostics
      ? { tavilyDiagnostics: args.tavilyDiagnostics }
      : {}),
  };
}
