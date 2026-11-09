import {
  contactResearchOutputSchema,
  type AiExecutionRequest,
  type ContactResearchOutput,
  type ContactResearchPerson,
  type ContactResearchPersonEmail,
} from '@influence-maven/ai-contracts';

import { BrightDataToolsClient } from '../brightdata/client';
import {
  evidenceSnippetAroundEmail,
  extractEmailsFromHtml,
} from '../brightdata/extract-emails';
import type { InfluencerAiEnv } from '../config/env';
import { buildBrandPeeCandidateUrls } from './brand-pee-pages';
import { collectLinkedInPeopleUrls } from './linkedin-profile-url';
import { buildPersonQueryLadder } from './person-query-ladder';

export type RunFindBrandPeopleSuccess = {
  ok: true;
  output: Extract<ContactResearchOutput, { operation: 'FIND_BRAND_PEOPLE' }>;
  llmCallCount: number;
};

export type RunFindBrandPeopleFailure = {
  ok: false;
  code: 'AI_PROVIDER_ERROR' | 'AI_INTERNAL_ERROR' | 'AI_INVALID_OUTPUT';
  message: string;
  retryable: boolean;
  llmCallCount: number;
};

export type RunFindBrandPeopleResult =
  | RunFindBrandPeopleSuccess
  | RunFindBrandPeopleFailure;

type ContactResearchRequest = Extract<
  AiExecutionRequest,
  { type: 'CONTACT_RESEARCH' }
>;

function createClientFromEnv(env: InfluencerAiEnv): BrightDataToolsClient {
  return new BrightDataToolsClient({
    apiKey: env.brightDataApiKey ?? '',
    serpZone: env.brightDataSerpZone ?? '',
    unlockerZone: env.brightDataUnlockerZone ?? 'mcp_unlocker',
    timeoutMs: env.brightDataTimeoutMs,
    linkedInPeopleDatasetId: env.brightDataLinkedInPeopleDatasetId,
    scraperPollTimeoutMs: env.brightDataScraperPollTimeoutMs,
    scraperPollIntervalMs: env.brightDataScraperPollIntervalMs,
  });
}

function emailsFromText(
  text: string,
  sourceUrl: string,
  sourceKind: ContactResearchPersonEmail['sourceKind'],
): ContactResearchPersonEmail[] {
  const found = extractEmailsFromHtml(text);
  return found.map((email) => ({
    email,
    sourceUrl,
    sourceKind,
    evidenceSnippet: evidenceSnippetAroundEmail(text, email) || undefined,
  }));
}

function firstNameToken(name: string): string | null {
  const part = name.trim().split(/\s+/)[0]?.toLowerCase();
  return part && part.length >= 2 ? part : null;
}

/**
 * Deterministic Track 2B: SERP ladder → LinkedIn scrape → email cascade A/B.
 * OCR (C) is skipped unless wired later; ocrEnabled only recorded in trace.
 */
export async function runContactResearchFindBrandPeople(
  env: InfluencerAiEnv,
  request: ContactResearchRequest,
  deps?: {
    client?: BrightDataToolsClient;
  },
): Promise<RunFindBrandPeopleResult> {
  if (request.input.operation !== 'FIND_BRAND_PEOPLE') {
    return {
      ok: false,
      code: 'AI_INTERNAL_ERROR',
      message: `Unsupported CONTACT_RESEARCH operation: ${request.input.operation}`,
      retryable: false,
      llmCallCount: 0,
    };
  }

  const input = request.input;
  const maxSerpQueries = input.maxSerpQueries ?? 4;
  const maxProfilesToScrape = input.maxProfilesToScrape ?? 5;
  const maxBrandPages = input.maxBrandPages ?? 6;

  const client = deps?.client ?? createClientFromEnv(env);
  if (!client.isConfigured()) {
    return {
      ok: false,
      code: 'AI_PROVIDER_ERROR',
      message:
        'Bright Data is not configured (BRIGHTDATA_API_KEY / SERP_ZONE / UNLOCKER_ZONE)',
      retryable: false,
      llmCallCount: 0,
    };
  }

  const queries = buildPersonQueryLadder({
    brandName: input.brandName,
    priorityRoles: input.priorityRoles,
    maxQueries: maxSerpQueries,
  });

  const executedQueries: string[] = [];
  const consideredUrls: string[] = [];
  const organicUrls: string[] = [];
  let serpCalls = 0;
  let serpFailures = 0;
  let lastError: string | undefined;

  try {
    for (const query of queries) {
      serpCalls += 1;
      executedQueries.push(query);
      const serp = await client.searchWeb(query, 10);
      if (!serp.ok) {
        serpFailures += 1;
        lastError = serp.brdError ?? serp.brdErrorCode ?? 'serp_failed';
        continue;
      }
      for (const hit of serp.organics) {
        organicUrls.push(hit.url);
      }
    }

    const linkedinUrls = collectLinkedInPeopleUrls(
      organicUrls,
      maxProfilesToScrape * 3,
    );
    consideredUrls.push(...linkedinUrls);

    const toScrape = linkedinUrls.slice(0, maxProfilesToScrape);
    const people: ContactResearchPerson[] = [];
    let profilesScraped = 0;

    for (const profileUrl of toScrape) {
      const scraped = await client.scrapeLinkedInProfile(profileUrl);
      if (!scraped.ok || !scraped.name) {
        lastError = scraped.error ?? lastError ?? 'scrape_failed';
        continue;
      }
      profilesScraped += 1;

      const emails: ContactResearchPersonEmail[] = [];
      // Fase A — LinkedIn dataset email fields + about/text literals
      for (const email of scraped.emailFields) {
        emails.push({
          email,
          sourceUrl: scraped.url || profileUrl,
          sourceKind: 'linkedin',
          evidenceSnippet: `dataset field: ${email}`,
        });
      }
      const aboutBlob = [scraped.about, scraped.title, scraped.name]
        .filter(Boolean)
        .join('\n');
      for (const e of emailsFromText(
        aboutBlob,
        scraped.url || profileUrl,
        'linkedin',
      )) {
        if (!emails.some((x) => x.email === e.email)) emails.push(e);
      }

      people.push({
        name: scraped.name,
        title: scraped.title,
        linkedinUrl: normalizeOutputLinkedIn(scraped.url, profileUrl),
        emails,
      });
    }

    // Fase B — PEE brand website: attach literales when name appears in evidence
    let brandPagesFetched = 0;
    if (people.length > 0 && maxBrandPages > 0) {
      const peeUrls = buildBrandPeeCandidateUrls(input.website, maxBrandPages);
      const brandHits: ContactResearchPersonEmail[] = [];
      for (const pageUrl of peeUrls) {
        const page = await client.openPage(pageUrl);
        brandPagesFetched += 1;
        if (!page.ok || !page.html) {
          lastError = page.brdError ?? lastError ?? 'unlocker_failed';
          continue;
        }
        for (const e of emailsFromText(page.html, pageUrl, 'brand_web')) {
          brandHits.push(e);
        }
      }

      for (const person of people) {
        if (person.emails.length > 0) continue;
        const token = firstNameToken(person.name);
        const matched = token
          ? brandHits.filter((e) =>
              (e.evidenceSnippet ?? '').toLowerCase().includes(token),
            )
          : [];
        if (matched.length > 0) {
          person.emails.push(...matched);
          continue;
        }
        // If no name match, still surface one generic brand inbox on first person only
        // so UI can show a reachable email (honest brand_web source).
      }

      const anyoneHasEmail = people.some((p) => p.emails.length > 0);
      if (!anyoneHasEmail && brandHits.length > 0 && people[0]) {
        people[0].emails.push(brandHits[0]);
      }
    }

    // Fase C OCR — not implemented in this runner step (flag reserved)
    const ocrAttempts = 0;
    void input.ocrEnabled;

    let outcome: 'RESULTS_FOUND' | 'NO_MATCHES' | 'PROVIDER_FAILURE' =
      people.length > 0 ? 'RESULTS_FOUND' : 'NO_MATCHES';

    if (people.length === 0) {
      const attempted = serpCalls > 0 || toScrape.length > 0;
      if (attempted && serpFailures === serpCalls && serpCalls > 0) {
        outcome = 'PROVIDER_FAILURE';
      } else if (attempted && toScrape.length > 0 && profilesScraped === 0) {
        outcome = 'PROVIDER_FAILURE';
      }
    }

    const candidate = {
      operation: 'FIND_BRAND_PEOPLE' as const,
      outcome,
      people,
      summary:
        people.length > 0
          ? `Found ${people.length} people (${people.filter((p) => p.emails.length > 0).length} with email)`
          : outcome === 'PROVIDER_FAILURE'
            ? `People search failed: ${lastError ?? 'provider error'}`
            : 'No LinkedIn people found within budget',
      trace: {
        queries: executedQueries,
        linkedinUrlsConsidered: consideredUrls,
        profilesScraped,
        serpCalls,
        brandPagesFetched,
        ocrAttempts,
      },
    };

    const contract = contactResearchOutputSchema.safeParse(candidate);
    if (!contract.success || contract.data.operation !== 'FIND_BRAND_PEOPLE') {
      return {
        ok: false,
        code: 'AI_INVALID_OUTPUT',
        message: contract.success
          ? 'Unexpected operation'
          : contract.error.message,
        retryable: false,
        llmCallCount: 0,
      };
    }

    return { ok: true, output: contract.data, llmCallCount: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = /timeout|429|5\d\d|ECONNREFUSED|fetch failed/i.test(
      message,
    );
    return {
      ok: false,
      code: retryable ? 'AI_PROVIDER_ERROR' : 'AI_INTERNAL_ERROR',
      message: message.slice(0, 2000),
      retryable,
      llmCallCount: 0,
    };
  }
}

function normalizeOutputLinkedIn(scrapedUrl: string, fallback: string): string {
  try {
    const u = new URL(scrapedUrl);
    if (u.hostname.includes('linkedin.com') && u.pathname.includes('/in/')) {
      return scrapedUrl.split('?')[0] ?? scrapedUrl;
    }
  } catch {
    /* fall through */
  }
  return fallback;
}
