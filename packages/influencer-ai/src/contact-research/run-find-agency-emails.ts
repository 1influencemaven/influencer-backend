import {
  contactResearchOutputSchema,
  type AiExecutionRequest,
  type ContactResearchOutput,
} from '@influence-maven/ai-contracts';
import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';

import { BrightDataToolsClient } from '../brightdata/client';
import { ContactResearchToolSession } from '../brightdata/session';
import { createContactResearchAgencyEmailsAgent } from '../agents/contact-research-agency-emails.agent';
import type { InfluencerAiEnv } from '../config/env';
import { buildContactResearchFindAgencyEmailsUserPrompt } from '../prompts/contact-research-find-agency-emails.prompt';
import {
  COMMERCIAL_SERP_SEED_MAX_PAGES,
  COMMERCIAL_SERP_SEED_MAX_QUERIES,
  seedCommercialSerpPages,
} from './commercial-serp-seed';
import {
  maxSeedPagesForBudget,
  maxSerpSeedPagesForBudget,
  maxSerpSeedQueriesForBudget,
} from './llm-budget-reserve';
import { buildContactResearchPageSnapshots } from './build-page-snapshots';
import {
  CONTACT_EMAIL_SEED_MAX_PAGES,
  seedBrandPagesForEmailDiscovery,
} from './seed-brand-pages';
import {
  AGENCY_COMMERCIAL_SEED_PATHS,
  buildAgencyCommercialSerpQueries,
} from './agency-seed-paths';
import {
  classifyAgencyMailboxRelevance,
  isEmailOnAgencyDomain,
  isExcludedAgencyMailboxLocal,
  isLikelyGenericAgencyMailbox,
  outreachRoleForAgencyMailbox,
} from './agency-email-classify';

/** Keep absolute http(s) URLs; domain gate stays in seed/session. */
function sanitizePreferredSeedUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      const key = parsed.href.toLowerCase().replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parsed.href);
    } catch {
      // drop malformed
    }
  }
  return out;
}

/** Drop seed URLs whose host is not the agency domain / subdomain. */
export function filterOnAgencyDomainSeedUrls(
  urls: string[],
  agencyDomain: string,
): string[] {
  const domain = agencyDomain.trim().toLowerCase().replace(/^www\./, '');
  if (!domain) return [];
  return urls.filter((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      return host === domain || host.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  });
}

export type RunFindAgencyEmailsSuccess = {
  ok: true;
  output: Extract<ContactResearchOutput, { operation: 'FIND_AGENCY_EMAILS' }>;
  llmCallCount: number;
};

export type RunFindAgencyEmailsFailure = {
  ok: false;
  code: 'AI_PROVIDER_ERROR' | 'AI_INTERNAL_ERROR' | 'AI_INVALID_OUTPUT';
  message: string;
  retryable: boolean;
  llmCallCount: number;
};

export type RunFindAgencyEmailsResult =
  | RunFindAgencyEmailsSuccess
  | RunFindAgencyEmailsFailure;

type ContactResearchRequest = Extract<
  AiExecutionRequest,
  { type: 'CONTACT_RESEARCH' }
>;

const llmOutputSchema = z.object({
  outcome: z.enum(['RESULTS_FOUND', 'NO_MATCHES', 'PROVIDER_FAILURE']),
  summary: z.string().optional(),
  emails: z
    .array(
      z.object({
        email: z.string(),
        sourceUrl: z.string().optional(),
      }),
    )
    .optional(),
});

function createClientFromEnv(env: InfluencerAiEnv): BrightDataToolsClient {
  return new BrightDataToolsClient({
    apiKey: env.brightDataApiKey ?? '',
    serpZone: env.brightDataSerpZone ?? '',
    unlockerZone: env.brightDataUnlockerZone ?? 'mcp_unlocker',
    timeoutMs: env.brightDataTimeoutMs,
  });
}

function mapTrustedEmails(
  sessionEmails: Array<{
    email: string;
    sourceUrl: string;
    evidenceSnippet?: string;
  }>,
  agencyDomain: string,
) {
  const out: Array<{
    email: string;
    sourceUrl: string;
    evidenceSnippet?: string;
    /** Always agency_web for FIND_AGENCY_EMAILS (domain mailbox, not person). */
    sourceKind: 'agency_web';
    isGeneric: boolean;
    commercialRelevance: 'HIGH' | 'NEUTRAL' | 'LOW' | 'UNKNOWN';
    outreachRole?: string;
    provenance: {
      discoveryStatus: 'FOUND';
      /** Domain/mailbox attribution to Agency — not person attribution. */
      attributionStatus: 'ATTRIBUTED';
      verificationStatus: 'UNVERIFIED';
    };
  }> = [];

  for (const e of sessionEmails) {
    if (isExcludedAgencyMailboxLocal(e.email)) continue;
    if (!isEmailOnAgencyDomain(e.email, agencyDomain)) continue;
    const outreachRole = outreachRoleForAgencyMailbox(e.email);
    out.push({
      email: e.email,
      sourceUrl: e.sourceUrl,
      evidenceSnippet: e.evidenceSnippet,
      sourceKind: 'agency_web',
      isGeneric: isLikelyGenericAgencyMailbox(e.email),
      commercialRelevance: classifyAgencyMailboxRelevance(e.email),
      ...(outreachRole ? { outreachRole } : {}),
      provenance: {
        discoveryStatus: 'FOUND',
        attributionStatus: 'ATTRIBUTED',
        verificationStatus: 'UNVERIFIED',
      },
    });
  }
  return out;
}

/**
 * 2C.4.4 — Mastra runner for FIND_AGENCY_EMAILS.
 * No Prisma / Nest persist. Nest domain gate remains authoritative in 2C.4.5.
 */
export async function runContactResearchFindAgencyEmails(
  env: InfluencerAiEnv,
  request: ContactResearchRequest,
  deps?: {
    client?: BrightDataToolsClient;
    createAgent?: (args: {
      env: InfluencerAiEnv;
      client: BrightDataToolsClient;
      session: ContactResearchToolSession;
    }) => Agent;
    skipLlm?: boolean;
  },
): Promise<RunFindAgencyEmailsResult> {
  if (request.input.operation !== 'FIND_AGENCY_EMAILS') {
    return {
      ok: false,
      code: 'AI_INTERNAL_ERROR',
      message: `Unsupported CONTACT_RESEARCH operation: ${request.input.operation}`,
      retryable: false,
      llmCallCount: 0,
    };
  }

  const input = request.input;
  const maxSerpQueries = input.maxSerpQueries ?? 5;
  const maxPages = input.maxPages ?? 5;

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

  // Session field is named brandName historically; value is agencyName (domain gate uses domain).
  const session = new ContactResearchToolSession({
    brandName: input.agencyName,
    website: input.website,
    domain: input.domain,
    maxSerpQueries,
    maxPages,
  });

  let llmCallCount = 0;
  try {
    const rawSeeds = sanitizePreferredSeedUrls(
      Array.isArray(input.seedUrls)
        ? input.seedUrls.filter((u): u is string => typeof u === 'string')
        : [],
    );
    const seedUrls = filterOnAgencyDomainSeedUrls(rawSeeds, input.domain);

    const maxSeedPages = maxSeedPagesForBudget(
      maxPages,
      CONTACT_EMAIL_SEED_MAX_PAGES,
    );

    const seed = await seedBrandPagesForEmailDiscovery({
      client,
      session,
      preferredUrls: seedUrls,
      maxSeedPages,
      seedPaths: AGENCY_COMMERCIAL_SEED_PATHS,
    });

    const serpMaxQueries = maxSerpSeedQueriesForBudget(
      maxSerpQueries,
      session.serpCalls,
      COMMERCIAL_SERP_SEED_MAX_QUERIES,
    );
    const serpMaxPages = maxSerpSeedPagesForBudget(
      maxPages,
      session.pageCalls,
      COMMERCIAL_SERP_SEED_MAX_PAGES,
    );

    const agencyQueries = buildAgencyCommercialSerpQueries({
      agencyName: input.agencyName,
      domain: input.domain,
      niche: input.niche,
      niches: input.niches,
      maxQueries: serpMaxQueries,
    });

    const serpSeed = await seedCommercialSerpPages({
      client,
      session,
      brandName: input.agencyName,
      domain: input.domain,
      niche: input.niche ?? undefined,
      maxQueries: serpMaxQueries,
      maxPages: serpMaxPages,
      queries: agencyQueries,
    });

    const seededOpened = [...seed.openedUrls, ...serpSeed.openedUrls];
    const seededAttempted =
      seed.attemptedUrls.length +
      serpSeed.openedUrls.length +
      serpSeed.failedUrls.length;

    const buildOutput = (
      trusted: ReturnType<typeof mapTrustedEmails>,
      outcome: 'RESULTS_FOUND' | 'NO_MATCHES' | 'PROVIDER_FAILURE',
      summary: string,
    ) => {
      const pageSnapshots = buildContactResearchPageSnapshots(session);
      return {
        operation: 'FIND_AGENCY_EMAILS' as const,
        outcome,
        emails: trusted,
        summary,
        ...(pageSnapshots.length > 0 ? { pageSnapshots } : {}),
        trace: session.toTrace(),
      };
    };

    if (deps?.skipLlm) {
      const trusted = mapTrustedEmails(session.listEmails(), input.domain);
      const outcome =
        trusted.length > 0
          ? 'RESULTS_FOUND'
          : seededOpened.length === 0 && seededAttempted > 0
            ? 'PROVIDER_FAILURE'
            : 'NO_MATCHES';
      const candidate = buildOutput(
        trusted,
        outcome,
        trusted.length > 0
          ? `Found ${trusted.length} literal email(s) on agency web pages`
          : seededOpened.length === 0
            ? 'Seed could not open any agency pages'
            : 'No literal agency emails found within budget',
      );
      const contract = contactResearchOutputSchema.safeParse(candidate);
      if (
        !contract.success ||
        contract.data.operation !== 'FIND_AGENCY_EMAILS'
      ) {
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
    }

    const agent = (deps?.createAgent ?? createContactResearchAgencyEmailsAgent)(
      {
        env,
        client,
        session,
      },
    );

    const prompt = buildContactResearchFindAgencyEmailsUserPrompt({
      agencyName: input.agencyName,
      website: input.website,
      domain: input.domain,
      niche: input.niche,
      niches: input.niches,
      country: input.country,
      markets: input.markets,
      maxSerpQueries,
      maxPages,
      seededPages: seededOpened,
      seededEmailCount: session.emails.size,
      preferredSeedUrls: seedUrls,
      remainingSearches: Math.max(0, maxSerpQueries - session.serpCalls),
      remainingPages: Math.max(0, maxPages - session.pageCalls),
    });

    const maxSteps = Math.min(20, 2 + maxSerpQueries * 2 + maxPages * 2);
    const result = await agent.generate(prompt, {
      maxSteps,
      structuredOutput: {
        schema: llmOutputSchema,
      },
    });
    llmCallCount = 1;

    const parsed = llmOutputSchema.safeParse(result.object);
    const trusted = mapTrustedEmails(session.listEmails(), input.domain);

    let outcome: 'RESULTS_FOUND' | 'NO_MATCHES' | 'PROVIDER_FAILURE' =
      trusted.length > 0 ? 'RESULTS_FOUND' : 'NO_MATCHES';

    const hadUsefulHtml = session.pageHtml.size > 0;
    if (trusted.length === 0 && !hadUsefulHtml) {
      const attemptedSomething =
        session.serpCalls + session.pageCalls > 0 || seededAttempted > 0;
      if (attemptedSomething && session.lastError) {
        outcome = 'PROVIDER_FAILURE';
      } else if (
        parsed.success &&
        parsed.data.outcome === 'PROVIDER_FAILURE'
      ) {
        outcome = 'PROVIDER_FAILURE';
      }
    }

    const candidate = buildOutput(
      trusted,
      outcome,
      parsed.success && parsed.data.summary
        ? parsed.data.summary
        : trusted.length > 0
          ? `Found ${trusted.length} literal email(s) on agency web pages`
          : 'No literal agency emails found within budget',
    );

    const contract = contactResearchOutputSchema.safeParse(candidate);
    if (
      !contract.success ||
      contract.data.operation !== 'FIND_AGENCY_EMAILS'
    ) {
      return {
        ok: false,
        code: 'AI_INVALID_OUTPUT',
        message: contract.success
          ? 'Unexpected operation'
          : contract.error.message,
        retryable: false,
        llmCallCount,
      };
    }

    return { ok: true, output: contract.data, llmCallCount };
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
      llmCallCount,
    };
  }
}
