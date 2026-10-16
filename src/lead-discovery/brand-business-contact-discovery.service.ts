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
    let pagesSucceeded = 0;
    let pagesFailed = 0;

    for (const pageUrl of pageUrls) {
      try {
        const fetched = await this.unlocker.fetchRawHtml(pageUrl);
        if (
          fetched.emptyBody ||
          fetched.httpStatus < 200 ||
          fetched.httpStatus >= 300
        ) {
          pagesFailed += 1;
          continue;
        }

        const normalizedFinal = normalizeBrandBusinessContactPageUrl(
          pageUrl,
          base,
        );
        if (!normalizedFinal) {
          pagesFailed += 1;
          continue;
        }

        pagesSucceeded += 1;
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
        this.logger.warn(
          JSON.stringify({
            event: 'brand_business_contact_page_failed',
            brandCandidateId: input.brandCandidateId,
            pageUrl,
            error: error instanceof Error ? error.message : String(error),
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

    return {
      candidates,
      summary: {
        pagesAttempted: pageUrls.length,
        pagesSucceeded,
        pagesFailed,
        emailsFound: byEmail.size,
        contactsCreated: 0,
        contactsUpdated: 0,
      },
    };
  }
}
