import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CommercialRelevance } from '../generated/prisma/enums';
import { BrightDataSearchClient } from './clients/brightdata-search.client';
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
import { normalizeWebsiteBase } from './utils/public-email-page-urls.util';
import { isAllowedBrandBusinessContactEmailDomain } from './utils/brand-business-contact-domain.util';
import type { BusinessContactDiscoverySummary } from './interfaces/lead-source-provider.interface';
import {
  classifyUnlockerHttpResult,
  sanitizeUnlockerErrorMessage,
  tallyPageOutcomes,
  type BusinessContactPageResult,
  type UnlockerFetchResult,
} from './utils/unlocker-fetch.util';

export type BrandBusinessContactDiscoveryInput = {
  brandCandidateId: string;
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

    const pageUrls = buildBrandBusinessContactPageUrls(
      input.website,
      maxPages,
    );
    const byEmail = new Map<string, DiscoveredBrandBusinessContact>();
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
          const emailNormalized = normalizeBusinessEmail(match.email);
          if (!emailLiteralInEvidence(emailNormalized, match.evidenceSnippet)) {
            continue;
          }
          if (
            !isAllowedBrandBusinessContactEmailDomain(
              emailNormalized,
              input.domain,
            )
          ) {
            continue;
          }

          const commercialRelevance =
            classifyCommercialRelevance(emailNormalized);
          if (commercialRelevance === CommercialRelevance.LOW) {
            continue;
          }

          const isGeneric = classifyPublicEmailGeneric(emailNormalized);
          const existing = byEmail.get(emailNormalized);
          if (!existing) {
            byEmail.set(emailNormalized, {
              email: emailNormalized,
              emailNormalized,
              isGeneric,
              commercialRelevance,
              sourceUrl: normalizedFinal,
              evidenceSnippet: match.evidenceSnippet,
            });
          } else if (
            commercialRelevance === CommercialRelevance.HIGH &&
            existing.commercialRelevance !== CommercialRelevance.HIGH
          ) {
            existing.commercialRelevance = CommercialRelevance.HIGH;
          }
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
      },
    };
  }
}
