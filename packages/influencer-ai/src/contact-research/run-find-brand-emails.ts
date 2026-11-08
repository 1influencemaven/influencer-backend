import {
  contactResearchOutputSchema,
  type AiExecutionRequest,
  type ContactResearchOutput,
} from '@influence-maven/ai-contracts';
import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';

import { BrightDataToolsClient } from '../brightdata/client';
import { ContactResearchToolSession } from '../brightdata/session';
import { createContactResearchAgent } from '../agents/contact-research.agent';
import type { InfluencerAiEnv } from '../config/env';
import { buildContactResearchFindEmailsUserPrompt } from '../prompts/contact-research-find-emails.prompt';
import { seedBrandPagesForEmailDiscovery } from './seed-brand-pages';

export type RunFindBrandEmailsSuccess = {
  ok: true;
  output: Extract<ContactResearchOutput, { operation: 'FIND_BRAND_EMAILS' }>;
  llmCallCount: number;
};

export type RunFindBrandEmailsFailure = {
  ok: false;
  code: 'AI_PROVIDER_ERROR' | 'AI_INTERNAL_ERROR' | 'AI_INVALID_OUTPUT';
  message: string;
  retryable: boolean;
  llmCallCount: number;
};

export type RunFindBrandEmailsResult =
  | RunFindBrandEmailsSuccess
  | RunFindBrandEmailsFailure;

type ContactResearchRequest = Extract<
  AiExecutionRequest,
  { type: 'CONTACT_RESEARCH' }
>;

const llmOutputSchema = z.object({
  outcome: z.enum(['RESULTS_FOUND', 'NO_MATCHES', 'PROVIDER_FAILURE']),
  summary: z.string().optional(),
  /** Model may list emails; we still trust only session-extracted ones. */
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

export async function runContactResearchFindBrandEmails(
  env: InfluencerAiEnv,
  request: ContactResearchRequest,
  /** Optional inject for tests */
  deps?: {
    client?: BrightDataToolsClient;
    createAgent?: (args: {
      env: InfluencerAiEnv;
      client: BrightDataToolsClient;
      session: ContactResearchToolSession;
    }) => Agent;
    /** Skip LLM (unit tests focused on seed). */
    skipLlm?: boolean;
  },
): Promise<RunFindBrandEmailsResult> {
  if (request.input.operation !== 'FIND_BRAND_EMAILS') {
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

  const session = new ContactResearchToolSession({
    brandName: input.brandName,
    website: input.website,
    domain: input.domain,
    maxSerpQueries,
    maxPages,
  });

  let llmCallCount = 0;
  try {
    const seed = await seedBrandPagesForEmailDiscovery({ client, session });

    if (deps?.skipLlm) {
      const trusted = session.listEmails().map((e) => ({
        email: e.email,
        sourceUrl: e.sourceUrl,
        evidenceSnippet: e.evidenceSnippet,
      }));
      const outcome =
        trusted.length > 0
          ? 'RESULTS_FOUND'
          : seed.openedUrls.length === 0 && seed.attemptedUrls.length > 0
            ? 'PROVIDER_FAILURE'
            : 'NO_MATCHES';
      const candidate = {
        operation: 'FIND_BRAND_EMAILS' as const,
        outcome,
        emails: trusted,
        summary:
          trusted.length > 0
            ? `Found ${trusted.length} literal email(s) on brand web pages`
            : seed.openedUrls.length === 0
              ? 'Seed could not open any brand pages'
              : 'No literal brand emails found within budget',
        trace: session.toTrace(),
      };
      const contract = contactResearchOutputSchema.safeParse(candidate);
      if (!contract.success || contract.data.operation !== 'FIND_BRAND_EMAILS') {
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

    const agent = (deps?.createAgent ?? createContactResearchAgent)({
      env,
      client,
      session,
    });

    const prompt = buildContactResearchFindEmailsUserPrompt({
      brandName: input.brandName,
      website: input.website,
      domain: input.domain,
      niche: input.niche,
      maxSerpQueries,
      maxPages,
      seededPages: seed.openedUrls,
      seededEmailCount: seed.emailsFound,
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
    const sessionEmails = session.listEmails();

    // Prefer tool/seed-extracted emails; ignore model-invented addresses not in session.
    const trusted = sessionEmails.map((e) => ({
      email: e.email,
      sourceUrl: e.sourceUrl,
      evidenceSnippet: e.evidenceSnippet,
    }));

    let outcome: 'RESULTS_FOUND' | 'NO_MATCHES' | 'PROVIDER_FAILURE' =
      trusted.length > 0 ? 'RESULTS_FOUND' : 'NO_MATCHES';

    // Seed/tools opened HTML but no emails → NO_MATCHES (do not trust LLM PROVIDER_FAILURE).
    const hadUsefulHtml = session.pageHtml.size > 0;
    if (trusted.length === 0 && !hadUsefulHtml) {
      const attemptedSomething =
        session.serpCalls + session.pageCalls > 0 ||
        seed.attemptedUrls.length > 0;
      if (attemptedSomething && session.lastError) {
        outcome = 'PROVIDER_FAILURE';
      } else if (
        parsed.success &&
        parsed.data.outcome === 'PROVIDER_FAILURE'
      ) {
        outcome = 'PROVIDER_FAILURE';
      }
    }

    const candidate = {
      operation: 'FIND_BRAND_EMAILS' as const,
      outcome,
      emails: trusted,
      summary:
        parsed.success && parsed.data.summary
          ? parsed.data.summary
          : trusted.length > 0
            ? `Found ${trusted.length} literal email(s) on brand web pages`
            : 'No literal brand emails found within budget',
      trace: session.toTrace(),
    };

    const contract = contactResearchOutputSchema.safeParse(candidate);
    if (!contract.success || contract.data.operation !== 'FIND_BRAND_EMAILS') {
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
