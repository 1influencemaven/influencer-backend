import {
  buildPeopleSearchTrace,
  classifyLeadDiscoveryOutcome,
} from './lead-discovery-outcome.util';
import type { PeopleSearchTrace } from '../interfaces/lead-source-provider.interface';

function trace(
  overrides: Partial<
    Omit<PeopleSearchTrace, 'selectedProfileUrlsCount'> & {
      selectedProfileUrls?: string[];
    }
  > = {},
): PeopleSearchTrace {
  const {
    selectedProfileUrls = [],
    searchFailureCodes = [],
    scraperErrorCodes = [],
    ...rest
  } = overrides;
  return buildPeopleSearchTrace({
    searchHitsReceived: 0,
    linkedinUrlValidated: 0,
    scoredCandidates: 0,
    qualifiedCandidates: 0,
    brightDataSearchRequests: 0,
    brightDataSearchFailures: 0,
    tavilyFallbackRequests: 0,
    scraperInvocations: 0,
    scraperSuccesses: 0,
    scraperFailures: 0,
    ...rest,
    selectedProfileUrls,
    searchFailureCodes,
    scraperErrorCodes,
  });
}

describe('classifyLeadDiscoveryOutcome', () => {
  it('PROVIDER_FAILURE when all Unlocker pages fail', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 0,
      businessContactDiscovery: {
        pagesAttempted: 12,
        pagesSucceeded: 0,
        pagesFailed: 12,
        emailsFound: 0,
        contactsCreated: 0,
        contactsUpdated: 0,
        failureCountsByCategory: { network_error: 12 },
      },
      peopleSearchTrace: trace({
        searchHitsReceived: 50,
        tavilyFallbackRequests: 10,
        brightDataSearchRequests: 20,
        brightDataSearchFailures: 20,
      }),
    });

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.warningCode).toBe('unlocker_all_pages_failed');
    expect(result.warningMessage).toMatch(/Unlocker failed/i);
  });

  it('PROVIDER_FAILURE for partial Unlocker success is not triggered', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 0,
      businessContactDiscovery: {
        pagesAttempted: 12,
        pagesSucceeded: 3,
        pagesFailed: 9,
        emailsFound: 0,
        contactsCreated: 0,
        contactsUpdated: 0,
        failureCountsByCategory: { network_error: 9 },
      },
    });

    expect(result.outcome).toBe('EMPTY_LEGITIMATE');
    expect(result.warningCode).toBeNull();
  });

  it('EMPTY_LEGITIMATE for valid search with zero results', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 0,
      businessContactDiscovery: {
        pagesAttempted: 4,
        pagesSucceeded: 4,
        pagesFailed: 0,
        emailsFound: 0,
        contactsCreated: 0,
        contactsUpdated: 0,
      },
      peopleSearchTrace: trace({
        searchHitsReceived: 10,
        linkedinUrlValidated: 0,
        scoredCandidates: 0,
        qualifiedCandidates: 0,
        brightDataSearchRequests: 2,
        brightDataSearchFailures: 0,
      }),
    });

    expect(result.outcome).toBe('EMPTY_LEGITIMATE');
    expect(result.warningCode).toBeNull();
  });

  it('FULL when leads persisted and no critical provider failure', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 3,
      businessContactsCreated: 0,
      businessContactDiscovery: {
        pagesAttempted: 2,
        pagesSucceeded: 2,
        pagesFailed: 0,
        emailsFound: 0,
        contactsCreated: 0,
        contactsUpdated: 0,
      },
      peopleSearchTrace: trace({
        searchHitsReceived: 8,
        linkedinUrlValidated: 3,
        scoredCandidates: 3,
        qualifiedCandidates: 3,
        selectedProfileUrls: [
          'https://linkedin.com/in/a',
          'https://linkedin.com/in/b',
          'https://linkedin.com/in/c',
        ],
        scraperInvocations: 1,
        scraperSuccesses: 1,
        brightDataSearchRequests: 2,
        brightDataSearchFailures: 0,
      }),
    });

    expect(result.outcome).toBe('FULL');
    expect(result.warningCode).toBeNull();
    expect(result.warningMessage).toBeNull();
  });

  it('EMPTY_LEGITIMATE when hits exist but zero LinkedIn URL candidates', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 0,
      peopleSearchTrace: trace({
        searchHitsReceived: 50,
        linkedinUrlValidated: 0,
        scoredCandidates: 0,
        qualifiedCandidates: 0,
        brightDataSearchRequests: 5,
        brightDataSearchFailures: 5,
        tavilyFallbackRequests: 10,
      }),
    });

    expect(result.outcome).toBe('EMPTY_LEGITIMATE');
  });

  it('EMPTY_LEGITIMATE when candidates scored but none pass threshold', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 0,
      peopleSearchTrace: trace({
        searchHitsReceived: 20,
        linkedinUrlValidated: 4,
        scoredCandidates: 4,
        qualifiedCandidates: 0,
        selectedProfileUrls: [],
        brightDataSearchRequests: 3,
        brightDataSearchFailures: 0,
      }),
    });

    expect(result.outcome).toBe('EMPTY_LEGITIMATE');
  });

  it('PROVIDER_FAILURE when scraper fails for every selected URL', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 0,
      peopleSearchTrace: trace({
        searchHitsReceived: 5,
        linkedinUrlValidated: 2,
        scoredCandidates: 2,
        qualifiedCandidates: 2,
        selectedProfileUrls: [
          'https://linkedin.com/in/a',
          'https://linkedin.com/in/b',
        ],
        scraperInvocations: 1,
        scraperSuccesses: 0,
        scraperFailures: 1,
        scraperErrorCodes: ['TypeError'],
        brightDataSearchRequests: 1,
        brightDataSearchFailures: 0,
      }),
    });

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.warningCode).toBe('people_scraper_all_failed');
  });

  it('PROVIDER_FAILURE when people search provider fails with no fallback hits', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 0,
      peopleSearchTrace: trace({
        searchHitsReceived: 0,
        brightDataSearchRequests: 5,
        brightDataSearchFailures: 5,
        tavilyFallbackRequests: 0,
        searchFailureCodes: ['NETWORK_ERROR'],
      }),
    });

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.warningCode).toBe('people_search_provider_failed');
  });

  it('mixed_provider_failure when Unlocker and scraper both fail', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 0,
      businessContactDiscovery: {
        pagesAttempted: 12,
        pagesSucceeded: 0,
        pagesFailed: 12,
        emailsFound: 0,
        contactsCreated: 0,
        contactsUpdated: 0,
      },
      peopleSearchTrace: trace({
        selectedProfileUrls: ['https://linkedin.com/in/a'],
        scraperInvocations: 1,
        scraperSuccesses: 0,
        scraperFailures: 1,
      }),
    });

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.warningCode).toBe('mixed_provider_failure');
  });

  it('does not treat absent peopleSearchTrace as provider failure', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 0,
      peopleSearchTrace: null,
    });

    expect(result.outcome).toBe('EMPTY_LEGITIMATE');
  });

  it('FULL when business contacts created even without people leads', () => {
    const result = classifyLeadDiscoveryOutcome({
      leadsPersisted: 0,
      businessContactsCreated: 2,
      businessContactDiscovery: {
        pagesAttempted: 3,
        pagesSucceeded: 3,
        pagesFailed: 0,
        emailsFound: 2,
        contactsCreated: 2,
        contactsUpdated: 0,
      },
    });

    expect(result.outcome).toBe('FULL');
  });
});

describe('buildPeopleSearchTrace', () => {
  it('stores known zeros distinctly from omitted legacy traces', () => {
    const built = buildPeopleSearchTrace({
      searchHitsReceived: 0,
      linkedinUrlValidated: 0,
      scoredCandidates: 0,
      qualifiedCandidates: 0,
      selectedProfileUrls: [],
      brightDataSearchRequests: 0,
      brightDataSearchFailures: 0,
      tavilyFallbackRequests: 0,
      scraperInvocations: 0,
      scraperSuccesses: 0,
      scraperFailures: 0,
      searchFailureCodes: [],
      scraperErrorCodes: [],
    });

    expect(built.searchHitsReceived).toBe(0);
    expect(built.linkedinUrlValidated).toBe(0);
    expect(built.selectedProfileUrlsCount).toBe(0);
    expect(built.scraperInvocations).toBe(0);
  });

  it('caps selected URLs at 50', () => {
    const urls = Array.from(
      { length: 60 },
      (_, i) => `https://linkedin.com/in/u${i}`,
    );
    const built = buildPeopleSearchTrace({
      searchHitsReceived: 60,
      linkedinUrlValidated: 60,
      scoredCandidates: 60,
      qualifiedCandidates: 60,
      selectedProfileUrls: urls,
      brightDataSearchRequests: 1,
      brightDataSearchFailures: 0,
      tavilyFallbackRequests: 0,
      scraperInvocations: 0,
      scraperSuccesses: 0,
      scraperFailures: 0,
      searchFailureCodes: [],
      scraperErrorCodes: [],
    });

    expect(built.selectedProfileUrls).toHaveLength(50);
    expect(built.selectedProfileUrlsCount).toBe(50);
  });

  it('forwards optional BD and Tavily diagnostics without inventing them', () => {
    const without = buildPeopleSearchTrace({
      searchHitsReceived: 0,
      linkedinUrlValidated: 0,
      scoredCandidates: 0,
      qualifiedCandidates: 0,
      selectedProfileUrls: [],
      brightDataSearchRequests: 1,
      brightDataSearchFailures: 1,
      tavilyFallbackRequests: 0,
      scraperInvocations: 0,
      scraperSuccesses: 0,
      scraperFailures: 0,
      searchFailureCodes: ['EMPTY_BODY'],
      scraperErrorCodes: [],
    });
    expect(without.brightDataDiagnostics).toBeUndefined();
    expect(without.tavilyDiagnostics).toBeUndefined();

    const withDiag = buildPeopleSearchTrace({
      searchHitsReceived: 0,
      linkedinUrlValidated: 0,
      scoredCandidates: 0,
      qualifiedCandidates: 0,
      selectedProfileUrls: [],
      brightDataSearchRequests: 2,
      brightDataSearchFailures: 1,
      tavilyFallbackRequests: 1,
      scraperInvocations: 0,
      scraperSuccesses: 0,
      scraperFailures: 0,
      searchFailureCodes: ['EMPTY_BODY', 'TIMEOUT'],
      scraperErrorCodes: [],
      brightDataDiagnostics: {
        requests: 2,
        hits: 0,
        emptyBody: 1,
        parseError: 0,
        organicEmpty: 1,
        networkError: 0,
        httpError: 0,
        httpStatusCounts: { '200': 2 },
      },
      tavilyDiagnostics: {
        requests: 1,
        hits: 0,
        httpOkWithResults: 0,
        httpOkEmptyResults: 0,
        httpError: 0,
        networkError: 0,
        timeout: 1,
      },
    });
    expect(withDiag.brightDataDiagnostics?.emptyBody).toBe(1);
    expect(withDiag.tavilyDiagnostics?.timeout).toBe(1);
  });
});
