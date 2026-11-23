import {
  AGENCY_CONTACT_DEFAULT_PRIORITY_ROLES,
  contactResearchOutputSchema,
  type AgencyContactPerson,
  type AgencyContactPersonEmail,
  type AiExecutionRequest,
  type ContactResearchOutput,
} from '@influence-maven/ai-contracts';

import { BrightDataToolsClient } from '../brightdata/client';
import type { BrightDataOrganicHit } from '../brightdata/types';
import {
  evidenceSnippetAroundEmail,
  extractEmailsFromHtml,
} from '../brightdata/extract-emails';
import { normalizeUrlKey } from '../brightdata/normalize-url-key';
import type { InfluencerAiEnv } from '../config/env';
import { buildAgencyPeeCandidateUrls } from './agency-pee-pages';
import {
  brandMatchKeys,
  profileBelongsToBrand,
  roleFromRow,
  roleFromSerpTitle,
  selectLinkedInPeopleHits,
} from './linkedin-people-hits';
import {
  emptyAgencyPeeReuseTrace,
  htmlFromPeeSnapshot,
  indexUsablePeeSnapshots,
} from './pee-snapshot-reuse';
import { buildPersonQueryLadder } from './person-query-ladder';

export type RunFindAgencyPeopleSuccess = {
  ok: true;
  output: Extract<ContactResearchOutput, { operation: 'FIND_AGENCY_PEOPLE' }>;
  llmCallCount: number;
};

export type RunFindAgencyPeopleFailure = {
  ok: false;
  code: 'AI_PROVIDER_ERROR' | 'AI_INTERNAL_ERROR' | 'AI_INVALID_OUTPUT';
  message: string;
  retryable: boolean;
  llmCallCount: number;
};

export type RunFindAgencyPeopleResult =
  | RunFindAgencyPeopleSuccess
  | RunFindAgencyPeopleFailure;

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

/** Shared inboxes — never attribute to a LinkedIn person (RF-01 / RF-01.1). */
const GENERIC_COMPANY_LOCALS = new Set([
  'info',
  'hello',
  'hola',
  'contact',
  'contacto',
  'support',
  'soporte',
  'marketing',
  'sales',
  'press',
  'media',
  'partnerships',
  'partnership',
  'partner',
  'business',
  'help',
  'affiliate',
  'affiliates',
  'creator',
  'creators',
  'collab',
  'collaboration',
  'collaborations',
  'influencer',
  'influencers',
  'talent',
  'campaigns',
  'noreply',
  'no-reply',
]);

function isGenericCompanyEmail(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return GENERIC_COMPANY_LOCALS.has(local);
}

function emailsFromText(
  text: string,
  sourceUrl: string,
  sourceKind: AgencyContactPersonEmail['sourceKind'],
): AgencyContactPersonEmail[] {
  const found = extractEmailsFromHtml(text);
  return found.map((email) => ({
    email,
    sourceUrl,
    sourceKind,
    evidenceSnippet: evidenceSnippetAroundEmail(text, email) || undefined,
    provenance: {
      discoveryStatus: 'FOUND' as const,
      attributionStatus: 'ATTRIBUTED' as const,
      verificationStatus: 'UNVERIFIED' as const,
    },
  }));
}

function firstNameToken(name: string): string | null {
  const part = name.trim().split(/\s+/)[0]?.toLowerCase();
  return part && part.length >= 2 ? part : null;
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

/**
 * 2C.4.6 — Deterministic FIND_AGENCY_PEOPLE.
 * SERP ladder → LinkedIn scrape → agency-web PEE (RF-04 snapshot reuse).
 * peoplePassPolicy ALWAYS is Nest-owned; this runner never gates on emails.
 */
export async function runContactResearchFindAgencyPeople(
  env: InfluencerAiEnv,
  request: ContactResearchRequest,
  deps?: {
    client?: BrightDataToolsClient;
  },
): Promise<RunFindAgencyPeopleResult> {
  if (request.input.operation !== 'FIND_AGENCY_PEOPLE') {
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
  const maxAgencyPages = input.maxAgencyPages ?? 6;

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

  const priorityRoles =
    input.priorityRoles?.length && input.priorityRoles.length > 0
      ? input.priorityRoles
      : [...AGENCY_CONTACT_DEFAULT_PRIORITY_ROLES];

  const queries = buildPersonQueryLadder({
    brandName: input.agencyName,
    priorityRoles,
    maxQueries: maxSerpQueries,
  });

  const executedQueries: string[] = [];
  const consideredUrls: string[] = [];
  const organics: BrightDataOrganicHit[] = [];
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
      organics.push(...serp.organics);
    }

    // Same rule as Track 2B: only profiles whose SERP title/snippet names the agency.
    const agencyKeys = brandMatchKeys(input.agencyName, input.domain);
    const linkedinHits = selectLinkedInPeopleHits(organics, {
      brandName: input.agencyName,
      domain: input.domain,
      limit: maxProfilesToScrape * 3,
    });
    consideredUrls.push(...linkedinHits.map((h) => h.url));

    const toScrape = linkedinHits.slice(0, maxProfilesToScrape);
    const people: AgencyContactPerson[] = [];
    let profilesScraped = 0;

    // Scrapes are independent dataset snapshots: run them together (each one
    // polls for ~30–60 s), then process in ranking order.
    const scrapes = await Promise.all(
      toScrape.map((hit) => client.scrapeLinkedInProfile(hit.url)),
    );
    for (const [index, hit] of toScrape.entries()) {
      const profileUrl = hit.url;
      const scraped = scrapes[index]!;
      if (!scraped.ok || !scraped.name) {
        lastError = scraped.error ?? lastError ?? 'scrape_failed';
        continue;
      }
      profilesScraped += 1;
      if (!profileBelongsToBrand(scraped, agencyKeys)) continue;

      const emails: AgencyContactPersonEmail[] = [];
      for (const email of scraped.emailFields) {
        emails.push({
          email,
          sourceUrl: scraped.url || profileUrl,
          sourceKind: 'linkedin',
          evidenceSnippet: `dataset field: ${email}`,
          provenance: {
            discoveryStatus: 'FOUND',
            attributionStatus: 'ATTRIBUTED',
            verificationStatus: 'UNVERIFIED',
          },
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
        title:
          scraped.title ??
          roleFromRow(scraped.raw) ??
          roleFromSerpTitle(hit.serpTitle),
        linkedinUrl: normalizeOutputLinkedIn(scraped.url, profileUrl),
        emails,
      });
    }

    let agencyPagesFetched = 0;
    const incomingSnapshots = input.pageSnapshots ?? [];
    const peeReuse = emptyAgencyPeeReuseTrace(incomingSnapshots.length);

    if (people.length > 0 && maxAgencyPages > 0) {
      const peeUrls = buildAgencyPeeCandidateUrls(
        input.website,
        maxAgencyPages,
      );
      const { byKey: reusableByKey, rejected } = indexUsablePeeSnapshots({
        snapshots: incomingSnapshots,
        peeCandidateUrls: peeUrls,
        brandDomain: input.domain,
      });
      peeReuse.peePagesRejected = rejected;

      const agencyHits: AgencyContactPersonEmail[] = [];
      for (const pageUrl of peeUrls) {
        const key = normalizeUrlKey(pageUrl);
        const snap = reusableByKey.get(key);
        let html: string | undefined;

        if (snap) {
          html = htmlFromPeeSnapshot(snap);
          peeReuse.peePagesReused += 1;
          peeReuse.unlockerCallsAvoided += 1;
        } else {
          const page = await client.openPage(pageUrl);
          agencyPagesFetched += 1;
          peeReuse.peePagesFetchedUnlocker += 1;
          if (!page?.ok || !page.html) {
            lastError = page?.brdError ?? lastError ?? 'unlocker_failed';
            continue;
          }
          html = page.html;
        }

        for (const e of emailsFromText(html, pageUrl, 'agency_web')) {
          agencyHits.push(e);
        }
      }

      // RF-01: attach agency_web email only when snippet mentions the person.
      // Never attribute by local-part alone; never attach generic company inboxes.
      for (const person of people) {
        if (person.emails.length > 0) continue;
        const token = firstNameToken(person.name);
        if (!token) continue;
        const matched = agencyHits.filter((e) => {
          const email = e.email.toLowerCase();
          const snippet = (e.evidenceSnippet ?? '').toLowerCase();
          if (isGenericCompanyEmail(email)) return false;
          if (!snippet.includes(email)) return false;
          const withoutEmail = snippet.split(email).join(' ');
          const nameWord = new RegExp(
            `(^|[^a-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`,
          );
          return nameWord.test(withoutEmail);
        });
        if (matched.length > 0) {
          person.emails.push(...matched);
        }
      }
    }

    const ocrAttempts = 0;
    void input.ocrEnabled;
    void input.peoplePassPolicy;

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
      operation: 'FIND_AGENCY_PEOPLE' as const,
      outcome,
      people,
      summary:
        people.length > 0
          ? `Found ${people.length} agency people (${people.filter((p) => p.emails.length > 0).length} with email)`
          : outcome === 'PROVIDER_FAILURE'
            ? `Agency people search failed: ${lastError ?? 'provider error'}`
            : 'No LinkedIn agency people found within budget',
      trace: {
        queries: executedQueries,
        linkedinUrlsConsidered: consideredUrls,
        profilesScraped,
        serpCalls,
        agencyPagesFetched,
        ocrAttempts,
        ...(incomingSnapshots.length > 0 ? { peeReuse } : {}),
      },
    };

    const contract = contactResearchOutputSchema.safeParse(candidate);
    if (!contract.success || contract.data.operation !== 'FIND_AGENCY_PEOPLE') {
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
