import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrightDataClient } from '../clients/brightdata.client';
import { BrightDataSearchClient } from '../clients/brightdata-search.client';
import type {
  ProfilePublicEmailInput,
  PublicEmailCandidate,
  PublicEmailDiscoveryResult,
  PublicEmailEvidence,
  PublicEmailPageFetchResult,
} from '../interfaces/public-email-evidence.interface';
import {
  emailLiteralInEvidence,
  extractLiteralEmailsFromText,
} from '../utils/literal-email-extract.util';
import { classifyPublicEmailGeneric } from '../utils/public-email-generic.util';
import { buildPublicEmailPageUrls } from '../utils/public-email-page-urls.util';

const LINKEDIN_COMPANY_SCRAPER_ID = 'gd_l1vikfnt1wgvvqz95w';

@Injectable()
export class PublicEmailEvidenceDiscoveryService {
  private readonly logger = new Logger(PublicEmailEvidenceDiscoveryService.name);
  private readonly maxPages: number;
  private readonly maxCandidates: number;

  constructor(
    private readonly unlocker: BrightDataSearchClient,
    private readonly brightDataClient: BrightDataClient,
    private readonly configService: ConfigService,
  ) {
    this.maxPages =
      this.configService.get<number>('MAX_EMAIL_DISCOVERY_PAGES') ?? 6;
    this.maxCandidates =
      this.configService.get<number>('MAX_EMAIL_CANDIDATES') ?? 20;
  }

  async discoverForProfile(
    input: ProfilePublicEmailInput,
  ): Promise<PublicEmailDiscoveryResult> {
    const website = await this.resolveCompanyWebsite(input);
    if (!website) {
      return this.emptyResult(input.companyName, undefined);
    }

    const pageUrls = buildPublicEmailPageUrls(website, this.maxPages);
    const candidateMap = new Map<string, PublicEmailCandidate>();
    const pageResults: PublicEmailPageFetchResult[] = [];
    let pagesSucceeded = 0;
    let errors = 0;

    for (const pageUrl of pageUrls) {
      const fetched = await this.fetchAndExtract(pageUrl);
      const pageResult: PublicEmailPageFetchResult = {
        url: fetched.url,
        httpStatus: fetched.httpStatus,
        latencyMs: fetched.latencyMs,
        emptyBody: fetched.emptyBody,
        emailCount: fetched.emailCount,
        error: fetched.error,
      };
      pageResults.push(pageResult);

      this.logger.log(
        JSON.stringify({
          event: 'public_email_page_fetch',
          company: input.companyName,
          url: pageResult.url,
          status: pageResult.httpStatus,
          latencyMs: pageResult.latencyMs,
          emailCount: pageResult.emailCount,
          error: pageResult.error,
        }),
      );

      if (pageResult.error || pageResult.httpStatus < 200 || pageResult.httpStatus >= 400) {
        errors += 1;
        continue;
      }
      if (pageResult.emptyBody) {
        errors += 1;
        continue;
      }
      pagesSucceeded += 1;
      this.mergePageEmails(candidateMap, fetched.matches, pageResult.url, input);
      if (candidateMap.size >= this.maxCandidates) {
        break;
      }
    }

    const candidates = [...candidateMap.values()].slice(0, this.maxCandidates);
    const summary = this.buildSummary(
      input.companyName,
      website,
      pageUrls.length,
      pagesSucceeded,
      errors,
      pageResults,
      candidates,
    );

    this.logger.log(JSON.stringify({ event: 'public_email_evidence_run', ...summary }));

    return { candidates, summary };
  }

  async discoverForProfiles(
    inputs: ProfilePublicEmailInput[],
  ): Promise<PublicEmailDiscoveryResult[]> {
    const results: PublicEmailDiscoveryResult[] = [];
    const seenWebsites = new Map<string, PublicEmailDiscoveryResult>();

    for (const input of inputs) {
      const website = await this.resolveCompanyWebsite(input);
      const cacheKey = website?.toLowerCase() ?? `profile:${input.profileUrl}`;
      if (website && seenWebsites.has(cacheKey)) {
        const cached = seenWebsites.get(cacheKey)!;
        results.push({
          candidates: cached.candidates.map((c) => ({
            ...c,
            personName: input.personName,
            profileUrl: input.profileUrl,
          })),
          summary: cached.summary,
        });
        continue;
      }

      const result = await this.discoverForProfile(input);
      if (website) {
        seenWebsites.set(cacheKey, result);
      }
      results.push(result);
    }

    return results;
  }

  parseProfileRecord(record: Record<string, unknown>): ProfilePublicEmailInput {
    const personName = String(
      record.name ??
        record.full_name ??
        [record.first_name, record.last_name].filter(Boolean).join(' ') ??
        '',
    ).trim();
    const profileUrl = String(
      record.url ?? record.profile_url ?? record.input_url ?? '',
    ).trim();
    const company = record.current_company as
      | { name?: string; link?: string }
      | undefined;
    return {
      personName,
      profileUrl,
      companyName: company?.name ?? String(record.current_company_name ?? ''),
      companyLinkedInUrl: company?.link,
    };
  }

  private async resolveCompanyWebsite(
    input: ProfilePublicEmailInput,
  ): Promise<string | null> {
    if (input.companyWebsite?.trim()) {
      return input.companyWebsite.trim();
    }

    if (!input.companyLinkedInUrl?.trim()) {
      return null;
    }

    try {
      const records = await this.brightDataClient.triggerAndCollect(
        LINKEDIN_COMPANY_SCRAPER_ID,
        [{ url: input.companyLinkedInUrl }],
      );
      const record = records[0];
      if (!record) {
        return null;
      }
      const website = String(record.website ?? record.company_url ?? '').trim();
      return website || null;
    } catch (error) {
      this.logger.warn(
        `Company website lookup failed: ${String(error)}`,
      );
      return null;
    }
  }

  private async fetchAndExtract(
    pageUrl: string,
  ): Promise<PublicEmailPageFetchResult & { matches: ReturnType<typeof extractLiteralEmailsFromText> }> {
    const fetchResult = await this.unlocker.fetchRawHtml(pageUrl);
    if (fetchResult.httpStatus < 200 || fetchResult.httpStatus >= 400) {
      return {
        url: pageUrl,
        httpStatus: fetchResult.httpStatus,
        latencyMs: fetchResult.elapsedMs,
        emptyBody: fetchResult.emptyBody,
        emailCount: 0,
        error: `http_${fetchResult.httpStatus}`,
        matches: [],
      };
    }
    if (fetchResult.emptyBody) {
      return {
        url: pageUrl,
        httpStatus: fetchResult.httpStatus,
        latencyMs: fetchResult.elapsedMs,
        emptyBody: true,
        emailCount: 0,
        error: 'empty_body',
        matches: [],
      };
    }

    const matches = extractLiteralEmailsFromText(fetchResult.html);
    return {
      url: pageUrl,
      httpStatus: fetchResult.httpStatus,
      latencyMs: fetchResult.elapsedMs,
      emptyBody: false,
      emailCount: matches.length,
      matches,
    };
  }

  private mergePageEmails(
    candidateMap: Map<string, PublicEmailCandidate>,
    matches: ReturnType<typeof extractLiteralEmailsFromText>,
    sourceUrl: string,
    input: ProfilePublicEmailInput,
  ): void {
    const discoveredAt = new Date().toISOString();
    for (const match of matches) {
      if (!emailLiteralInEvidence(match.email, match.evidenceSnippet)) {
        continue;
      }
      const evidence: PublicEmailEvidence = {
        sourceUrl,
        sourceType: 'public-web',
        evidenceSnippet: match.evidenceSnippet,
        discoveredAt,
      };
      const existing = candidateMap.get(match.email);
      if (existing) {
        const duplicateUrl = existing.evidences.some(
          (e) => e.sourceUrl === evidence.sourceUrl,
        );
        if (!duplicateUrl) {
          existing.evidences.push(evidence);
        }
        continue;
      }
      candidateMap.set(match.email, {
        email: match.email,
        isGeneric: classifyPublicEmailGeneric(match.email),
        companyName: input.companyName,
        personName: input.personName,
        profileUrl: input.profileUrl,
        evidences: [evidence],
      });
    }
  }

  private buildSummary(
    companyName: string | undefined,
    website: string | undefined,
    pagesAttempted: number,
    pagesSucceeded: number,
    errors: number,
    pageResults: PublicEmailPageFetchResult[],
    candidates: PublicEmailCandidate[],
  ) {
    const genericEmailsFound = candidates.filter((c) => c.isGeneric).length;
    return {
      companyName,
      website,
      pagesAttempted,
      pagesSucceeded,
      emailsFound: candidates.length,
      genericEmailsFound,
      nonGenericEmailsFound: candidates.length - genericEmailsFound,
      errors,
      pageResults,
    };
  }

  private emptyResult(
    companyName?: string,
    website?: string,
  ): PublicEmailDiscoveryResult {
    return {
      candidates: [],
      summary: {
        companyName,
        website,
        pagesAttempted: 0,
        pagesSucceeded: 0,
        emailsFound: 0,
        genericEmailsFound: 0,
        nonGenericEmailsFound: 0,
        errors: 0,
        pageResults: [],
      },
    };
  }
}
