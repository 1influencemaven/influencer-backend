import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CommercialRelevance } from '../generated/prisma/enums';
import {
  BrightDataSearchClient,
  classifyUnlockerHttpResult,
  sanitizeUnlockerErrorMessage,
  tallyPageOutcomes,
  type BusinessContactPageResult,
  type UnlockerFetchResult,
} from '../integrations/brightdata';
import {
  extractLiteralEmailsFromText,
  emailLiteralInEvidence,
} from './utils/literal-email-extract.util';
import { classifyPublicEmailGeneric } from './utils/public-email-generic.util';
import {
  classifyCommercialRelevance,
  normalizeBusinessEmail,
} from './utils/commercial-relevance.util';
import {
  buildBrandBusinessContactPageUrls,
  normalizeBrandBusinessContactPageUrl,
} from './utils/brand-business-contact-page-urls.util';
import { buildBrandBusinessContactSearchQueries } from './utils/brand-business-contact-search-queries.util';
import { normalizeWebsiteBase } from './utils/public-email-page-urls.util';
import { isAllowedBrandBusinessContactEmailDomain } from './utils/brand-business-contact-domain.util';
import type { BusinessContactDiscoverySummary } from './interfaces/lead-source-provider.interface';

export type BrandBusinessContactDiscoveryInput = {
  brandCandidateId: string;
  brandName?: string;
  website: string;
  domain: string;
};

export type DiscoveredBrandBusinessContact = {
  email: string;
  emailNormalized: string;
  isGeneric: boolean;
  commercialRelevance: CommercialRelevance;
  sourceUrl: string;
  evidenceSnippet: string;
};

export type BrandBusinessContactDiscoveryResult = {
  candidates: DiscoveredBrandBusinessContact[];
  summary: BusinessContactDiscoverySummary;
};

type DiscardReason =
  | 'low_relevance'
  | 'external_domain'
  | 'missing_literal_evidence';

function resolveFetchOutcome(
  fetched: UnlockerFetchResult,
): UnlockerFetchResult['outcome'] {
  if (fetched.outcome) {
    return fetched.outcome;
  }
  const bodyLength =
    fetched.bodyLength ??
    (typeof fetched.html === 'string' ? fetched.html.length : 0);
  return classifyUnlockerHttpResult({
    httpStatus: fetched.httpStatus,
    bodyLength,
  });
}

function pageResultFromFetch(
  url: string,
  fetched: UnlockerFetchResult,
  outcome: BusinessContactPageResult['outcome'] = resolveFetchOutcome(fetched),
): BusinessContactPageResult {
  const bodyLength =
    fetched.bodyLength ??
    (typeof fetched.html === 'string' ? fetched.html.length : 0);
  const result: BusinessContactPageResult = {
    url,
    outcome,
    apiHttpStatus: fetched.httpStatus,
    bodyLength,
    elapsedMs: fetched.elapsedMs,
    zone: fetched.zone ?? '',
  };
  if (fetched.errorName) {
    result.errorName = fetched.errorName;
  }
  if (fetched.errorMessage) {
    result.errorMessage = sanitizeUnlockerErrorMessage(fetched.errorMessage);
  }
  if (fetched.causeName) result.causeName = fetched.causeName;
  if (fetched.causeCode) result.causeCode = fetched.causeCode;
  if (fetched.causeSyscall) result.causeSyscall = fetched.causeSyscall;
  if (fetched.causeHostname) result.causeHostname = fetched.causeHostname;
  if (fetched.causePort !== undefined) result.causePort = fetched.causePort;
  return result;
}

@Injectable()
export class BrandBusinessContactDiscoveryService {
  private readonly logger = new Logger(
    BrandBusinessContactDiscoveryService.name,
  );

  constructor(
    private readonly unlocker: BrightDataSearchClient,
    private readonly configService: ConfigService,
  ) {}

  async discover(
    input: BrandBusinessContactDiscoveryInput,
  ): Promise<BrandBusinessContactDiscoveryResult> {
    const emptySummary: BusinessContactDiscoverySummary = {
      pagesAttempted: 0,
      pagesSucceeded: 0,
      pagesFailed: 0,
      emailsFound: 0,
      contactsCreated: 0,
      contactsUpdated: 0,
    };

    const base = normalizeWebsiteBase(input.website);
    if (!base || !input.domain.trim()) {
      this.logger.warn(
        JSON.stringify({
          event: 'brand_business_contact_skip',
          brandCandidateId: input.brandCandidateId,
          reason: 'invalid_or_missing_website',
        }),
      );
      return { candidates: [], summary: emptySummary };
    }

    const maxPages =
      this.configService.get<number>('MAX_BRAND_BUSINESS_CONTACT_PAGES') ?? 12;
    const maxContacts =
      this.configService.get<number>('MAX_BRAND_BUSINESS_CONTACTS') ?? 15;

    const byEmail = new Map<string, DiscoveredBrandBusinessContact>();
    const discardCountsByReason: Record<string, number> = {};
    const bumpDiscard = (reason: DiscardReason) => {
      discardCountsByReason[reason] = (discardCountsByReason[reason] ?? 0) + 1;
    };

    const acceptEmail = (args: {
      email: string;
      sourceUrl: string;
      evidenceSnippet: string;
    }): void => {
      const emailNormalized = normalizeBusinessEmail(args.email);
      if (!emailLiteralInEvidence(emailNormalized, args.evidenceSnippet)) {
        bumpDiscard('missing_literal_evidence');
        return;
      }
      if (
        !isAllowedBrandBusinessContactEmailDomain(
          emailNormalized,
          input.domain,
        )
      ) {
        bumpDiscard('external_domain');
        return;
      }

      const commercialRelevance = classifyCommercialRelevance(emailNormalized);
      if (commercialRelevance === CommercialRelevance.LOW) {
        bumpDiscard('low_relevance');
        return;
      }

      const isGeneric = classifyPublicEmailGeneric(emailNormalized);
      const existing = byEmail.get(emailNormalized);
      if (!existing) {
        byEmail.set(emailNormalized, {
          email: emailNormalized,
          emailNormalized,
          isGeneric,
          commercialRelevance,
          sourceUrl: args.sourceUrl,
          evidenceSnippet: args.evidenceSnippet,
        });
        return;
      }
      if (
        commercialRelevance === CommercialRelevance.HIGH &&
        existing.commercialRelevance !== CommercialRelevance.HIGH
      ) {
        existing.commercialRelevance = CommercialRelevance.HIGH;
      }
      // Prefer a longer literal snippet when the same inbox is rediscovered.
      if (
        args.evidenceSnippet.length > existing.evidenceSnippet.length &&
        emailLiteralInEvidence(emailNormalized, args.evidenceSnippet)
      ) {
        existing.evidenceSnippet = args.evidenceSnippet;
        existing.sourceUrl = args.sourceUrl;
      }
    };

    const plannedSearchQueries = buildBrandBusinessContactSearchQueries({
      brandName: input.brandName?.trim() || input.domain,
      domain: input.domain,
    });
    let searchHitsProcessed = 0;
    let searchRequestsAttempted = 0;
    const searchFailureCountsByCategory: Record<string, number> = {};
    const bumpSearchFailure = (category: string) => {
      searchFailureCountsByCategory[category] =
        (searchFailureCountsByCategory[category] ?? 0) + 1;
    };
    const extraPageUrls: string[] = [];

    if (this.unlocker.isConfigured() && plannedSearchQueries.length > 0) {
      for (const query of plannedSearchQueries) {
        searchRequestsAttempted += 1;
        try {
          const searched = await this.unlocker.search({
            text: query,
            num: 10,
          });
          const category = searched.meta?.resultCategory;
          if (
            category === 'empty_body' ||
            category === 'parse_error' ||
            category === 'network_error' ||
            category === 'http_error'
          ) {
            bumpSearchFailure(category);
          } else if (
            searched.meta?.emptyBody === true ||
            (searched.meta?.httpStatus !== undefined &&
              searched.meta.httpStatus !== 0 &&
              searched.meta.httpStatus < 200) ||
            (searched.meta?.httpStatus !== undefined &&
              searched.meta.httpStatus >= 300)
          ) {
            bumpSearchFailure(
              searched.meta.emptyBody
                ? 'empty_body'
                : searched.meta.httpStatus === 0
                  ? 'network_error'
                  : 'http_error',
            );
          }
          for (const item of searched.items) {
            searchHitsProcessed += 1;
            const blob = `${item.title ?? ''} ${item.snippet ?? ''}`.trim();
            if (blob) {
              for (const match of extractLiteralEmailsFromText(blob)) {
                acceptEmail({
                  email: match.email,
                  sourceUrl: item.url || base,
                  evidenceSnippet: match.evidenceSnippet,
                });
              }
            }
            if (item.url) {
              const normalized = normalizeBrandBusinessContactPageUrl(
                item.url,
                base,
              );
              if (normalized) {
                extraPageUrls.push(normalized);
              }
            }
          }
        } catch (error) {
          bumpSearchFailure('network_error');
          this.logger.warn(
            JSON.stringify({
              event: 'brand_business_contact_search_failed',
              brandCandidateId: input.brandCandidateId,
              query,
              errorName: error instanceof Error ? error.name : 'Error',
              errorMessage: sanitizeUnlockerErrorMessage(
                error instanceof Error ? error.message : String(error),
              ),
            }),
          );
        }
      }
    }

    const seededPages = buildBrandBusinessContactPageUrls(
      input.website,
      maxPages,
    );
    const pageUrls: string[] = [];
    const seenPages = new Set<string>();
    for (const url of [...seededPages, ...extraPageUrls]) {
      if (pageUrls.length >= maxPages) {
        break;
      }
      const key = url.toLowerCase();
      if (seenPages.has(key)) {
        continue;
      }
      seenPages.add(key);
      pageUrls.push(url);
    }

    const pageResults: BusinessContactPageResult[] = [];
    let pagesSucceeded = 0;
    let pagesFailed = 0;
    let unlockerZone: string | undefined;

    for (const pageUrl of pageUrls) {
      try {
        const fetched = await this.unlocker.fetchRawHtml(pageUrl);
        unlockerZone = fetched.zone || unlockerZone;
        const fetchOutcome = resolveFetchOutcome(fetched);

        if (fetchOutcome !== 'ok') {
          pagesFailed += 1;
          pageResults.push(
            pageResultFromFetch(pageUrl, fetched, fetchOutcome),
          );
          continue;
        }

        const normalizedFinal = normalizeBrandBusinessContactPageUrl(
          pageUrl,
          base,
        );
        if (!normalizedFinal) {
          pagesFailed += 1;
          pageResults.push(
            pageResultFromFetch(pageUrl, fetched, 'url_normalization_error'),
          );
          continue;
        }

        pagesSucceeded += 1;
        pageResults.push(pageResultFromFetch(pageUrl, fetched, 'ok'));

        const matches = extractLiteralEmailsFromText(fetched.html);
        for (const match of matches) {
          acceptEmail({
            email: match.email,
            sourceUrl: normalizedFinal,
            evidenceSnippet: match.evidenceSnippet,
          });
        }
      } catch (error) {
        pagesFailed += 1;
        const errorName = error instanceof Error ? error.name : 'Error';
        const errorMessage = sanitizeUnlockerErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
        pageResults.push({
          url: pageUrl,
          outcome: 'unknown_error',
          apiHttpStatus: 0,
          bodyLength: 0,
          elapsedMs: 0,
          zone: unlockerZone ?? '',
          errorName,
          errorMessage,
        });
        this.logger.warn(
          JSON.stringify({
            event: 'brand_business_contact_page_failed',
            brandCandidateId: input.brandCandidateId,
            pageUrl,
            outcome: 'unknown_error',
            errorName,
            errorMessage,
          }),
        );
      }
    }

    const ranked = [...byEmail.values()].sort((a, b) => {
      const rank = (r: CommercialRelevance) =>
        r === CommercialRelevance.HIGH ? 2 : 1;
      return rank(b.commercialRelevance) - rank(a.commercialRelevance);
    });
    const candidates = ranked.slice(0, Math.max(maxContacts, 1));
    const failureCountsByCategory = tallyPageOutcomes(pageResults);

    return {
      candidates,
      summary: {
        pagesAttempted: pageUrls.length,
        pagesSucceeded,
        pagesFailed,
        emailsFound: byEmail.size,
        contactsCreated: 0,
        contactsUpdated: 0,
        unlockerZone,
        failureCountsByCategory,
        pageResults,
        plannedSearchQueries,
        searchHitsProcessed,
        searchRequestsAttempted,
        ...(Object.keys(searchFailureCountsByCategory).length > 0
          ? { searchFailureCountsByCategory }
          : {}),
        discardCountsByReason,
      },
    };
  }
}
