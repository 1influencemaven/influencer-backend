import {
  contactResearchOutputSchema,
  type AiExecutionRequest,
  type ContactResearchOutput,
  type ContactResearchPerson,
  type ContactResearchPersonEmail,
} from '@influence-maven/ai-contracts';

import { BrightDataToolsClient } from '../brightdata/client';
import type { BrightDataOrganicHit } from '../brightdata/types';
import {
  evidenceSnippetAroundEmail,
  extractEmailsFromHtml,
} from '../brightdata/extract-emails';
import { normalizeUrlKey } from '../brightdata/normalize-url-key';
import type { InfluencerAiEnv } from '../config/env';
import { buildBrandPeeCandidateUrls } from './brand-pee-pages';
import {
  brandMatchKeys,
  profileBelongsToBrand,
  roleFromRow,
  roleFromSerpTitle,
  selectLinkedInPeopleHits,
} from './linkedin-people-hits';
import { normalizeLinkedInPeopleUrl } from './linkedin-profile-url';
import {
  emptyPeeReuseTrace,
  htmlFromPeeSnapshot,
  indexUsablePeeSnapshots,
} from './pee-snapshot-reuse';
import {
  buildLinkedInPeopleQueries,
  fetchZoomInfoLeaders,
  findLeaderLinkedInHit,
  isClearlyUselessRole,
  isUsefulRole,
} from './people-sources';

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

/** Company inbox locals — never attribute to a LinkedIn person (RF-01 / RF-01.1). */
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

  const queries = buildLinkedInPeopleQueries({
    brandName: input.brandName,
    priorityRoles: input.priorityRoles,
    maxQueries: maxSerpQueries,
  });

  const executedQueries: string[] = [];
  const consideredUrls: string[] = [];
  const organics: BrightDataOrganicHit[] = [];
  let serpCalls = 0;
  let serpFailures = 0;
  let lastError: string | undefined;

  try {
    // SERP queries and the ZoomInfo leadership lookup are independent.
    const leadersPromise = fetchZoomInfoLeaders(client, input.domain);
    const serps = await Promise.all(
      queries.map((query) => client.searchWeb(query, 10)),
    );
    for (const [index, serp] of serps.entries()) {
      serpCalls += 1;
      executedQueries.push(queries[index]!);
      if (!serp.ok) {
        serpFailures += 1;
        lastError = serp.brdError ?? serp.brdErrorCode ?? 'serp_failed';
        continue;
      }
      organics.push(...serp.organics);
    }

    // ZoomInfo leaders are confirmed employees: resolve their LinkedIn profile
    // and rank them ahead of SERP-only matches.
    const { leaders, error: leadersError } = await leadersPromise;
    const leaderHits = (
      await Promise.all(
        leaders.map((leader) =>
          findLeaderLinkedInHit(client, leader, input.brandName),
        ),
      )
    ).filter((hit): hit is BrightDataOrganicHit => Boolean(hit));
    serpCalls += leaders.length;

    // Only profiles whose Google title/snippet names the brand; role keywords rank first.
    const brandKeys = brandMatchKeys(input.brandName, input.domain);
    const serpPeople = selectLinkedInPeopleHits(organics, {
      brandName: input.brandName,
      domain: input.domain,
      limit: maxProfilesToScrape * 3,
    });
    const leaderPeople = selectLinkedInPeopleHits(leaderHits, {
      brandName: input.brandName,
      domain: input.domain,
      limit: leaderHits.length,
    }).map((hit) => ({ ...hit, roleScore: hit.roleScore + 100 }));
    const seenUrls = new Set<string>();
    const linkedinHits = [...leaderPeople, ...serpPeople].filter((hit) => {
      const key = hit.url.toLowerCase();
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      // Skip store-floor / back-office roles before paying for a scrape.
      return !isClearlyUselessRole(roleFromSerpTitle(hit.serpTitle));
    });
    consideredUrls.push(...linkedinHits.map((h) => h.url));

    const toScrape = linkedinHits.slice(0, maxProfilesToScrape);
    let profilesRejectedOtherCompany = 0;
    let profilesRejectedRole = 0;
    const people: ContactResearchPerson[] = [];
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
      if (!profileBelongsToBrand(scraped, brandKeys)) {
        profilesRejectedOtherCompany += 1;
        continue;
      }
      const role =
        scraped.title ??
        roleFromRow(scraped.raw) ??
        roleFromSerpTitle(hit.serpTitle);
      if (!isUsefulRole(role)) {
        profilesRejectedRole += 1;
        continue;
      }

      const emails: ContactResearchPersonEmail[] = [];
      // Fase A — LinkedIn dataset + about/text.
      // RF-01.1: keep shared inboxes on the person payload so Nest can reclassify
      // them as BBC; do not treat them as personal (Nest canAttribute rejects).
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
        title: role,
        linkedinUrl: normalizeOutputLinkedIn(scraped.url, profileUrl),
        emails,
      });
    }

    // Fase B — PEE brand website: attach literales when name appears in evidence
    let brandPagesFetched = 0;
    const incomingSnapshots = input.pageSnapshots ?? [];
    const peeReuse = emptyPeeReuseTrace(incomingSnapshots.length);

    if (people.length > 0 && maxBrandPages > 0) {
      const peeUrls = buildBrandPeeCandidateUrls(input.website, maxBrandPages);
      const { byKey: reusableByKey, rejected } = indexUsablePeeSnapshots({
        snapshots: incomingSnapshots,
        peeCandidateUrls: peeUrls,
        brandDomain: input.domain,
      });
      peeReuse.peePagesRejected = rejected;

      const brandHits: ContactResearchPersonEmail[] = [];
      for (const pageUrl of peeUrls) {
        const key = normalizeUrlKey(pageUrl);
        const snap = reusableByKey.get(key);
        let html: string | undefined;

        if (snap) {
          // RF-04.3: reuse complete snapshot content; truncated but non-empty is OK.
          // Do not Unlocker-fallback solely because extraction found no email.
          html = htmlFromPeeSnapshot(snap);
          peeReuse.peePagesReused += 1;
          peeReuse.unlockerCallsAvoided += 1;
        } else {
          const page = await client.openPage(pageUrl);
          brandPagesFetched += 1;
          peeReuse.peePagesFetchedUnlocker += 1;
          if (!page.ok || !page.html) {
            lastError = page.brdError ?? lastError ?? 'unlocker_failed';
            continue;
          }
          html = page.html;
        }

        for (const e of emailsFromText(html, pageUrl, 'brand_web')) {
          brandHits.push(e);
        }
      }

      // RF-01: attach brand_web email to a person only when the evidence snippet
      // mentions that person. Never assign a generic brand inbox to the first
      // LinkedIn profile without an explicit person↔email link.
      for (const person of people) {
        if (person.emails.length > 0) continue;
        const token = firstNameToken(person.name);
        if (!token) continue;
        const matched = brandHits.filter((e) => {
          const email = e.email.toLowerCase();
          const snippet = (e.evidenceSnippet ?? '').toLowerCase();
          // Generic company locals stay corporate — not person-attributed here.
          if (isGenericCompanyEmail(email)) return false;
          if (!snippet.includes(email)) return false;
          // Name must appear outside the email local-part.
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
        profilesRejectedOtherCompany,
        profilesRejectedRole,
        zoomInfoLeaders: leaders.length,
        zoomInfoLeadersMatched: leaderPeople.length,
        ...(leadersError ? { zoomInfoError: leadersError.slice(0, 300) } : {}),
        serpCalls,
        brandPagesFetched,
        ocrAttempts,
        // RF-04.3: only emit when 2A snapshots were present (historical-compatible omit).
        ...(incomingSnapshots.length > 0 ? { peeReuse } : {}),
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

/**
 * Canonical profile URL (www host, lower-case slug) so the same person seen via
 * different country subdomains or slug casing persists as one lead.
 */
function normalizeOutputLinkedIn(scrapedUrl: string, fallback: string): string {
  return (
    normalizeLinkedInPeopleUrl(scrapedUrl) ??
    normalizeLinkedInPeopleUrl(fallback) ??
    fallback
  );
}
