import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import type { BrightDataToolsClient } from './client';
import {
  evidenceSnippetAroundEmail,
  extractEmailsFromHtml,
} from './extract-emails';
import type { ContactResearchToolSession } from './session';

function htmlToTextPreview(html: string, max = 4000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function createContactResearchTools(params: {
  client: BrightDataToolsClient;
  session: ContactResearchToolSession;
}) {
  const { client, session } = params;

  const search_web = createTool({
    id: 'search_web',
    description:
      'Search Google via Bright Data SERP. Use for brand partnership/contact queries. Returns organic title/url/snippet only.',
    inputSchema: z.object({
      query: z.string().min(3).max(300),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      query: z.string(),
      organics: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
        }),
      ),
      error: z.string().optional(),
      remainingSearches: z.number().int(),
    }),
    execute: async ({ query }) => {
      if (session.serpCalls >= session.maxSerpQueries) {
        return {
          ok: false,
          query,
          organics: [],
          error: `SERP budget exhausted (max ${session.maxSerpQueries})`,
          remainingSearches: 0,
        };
      }
      session.serpCalls += 1;
      session.queries.push(query);
      const result = await client.searchWeb(query);
      if (!result.ok) {
        session.lastError =
          result.brdError ?? result.brdErrorCode ?? 'serp_failed';
        return {
          ok: false,
          query,
          organics: [],
          error: session.lastError,
          remainingSearches: Math.max(
            0,
            session.maxSerpQueries - session.serpCalls,
          ),
        };
      }
      return {
        ok: true,
        query,
        organics: result.organics,
        remainingSearches: Math.max(
          0,
          session.maxSerpQueries - session.serpCalls,
        ),
      };
    },
  });

  const open_page = createTool({
    id: 'open_page',
    description:
      'Fetch a page HTML via Bright Data Unlocker. Only URLs on the approved brand domain are allowed. Returns truncated text, not raw HTML.',
    inputSchema: z.object({
      url: z.string().url(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      url: z.string(),
      textPreview: z.string().optional(),
      targetStatusCode: z.number().optional(),
      error: z.string().optional(),
      remainingPages: z.number().int(),
    }),
    execute: async ({ url }) => {
      if (!session.isAllowedUrl(url)) {
        return {
          ok: false,
          url,
          error: `URL host not allowed for brand domain ${session.allowedHost}`,
          remainingPages: Math.max(0, session.maxPages - session.pageCalls),
        };
      }
      if (session.pageCalls >= session.maxPages) {
        return {
          ok: false,
          url,
          error: `Page budget exhausted (max ${session.maxPages})`,
          remainingPages: 0,
        };
      }
      session.pageCalls += 1;
      session.pages.push(url);
      const result = await client.openPage(url);
      if (!result.ok || !result.html) {
        session.lastError =
          result.brdError ??
          (result.targetStatusCode
            ? `target_http_${result.targetStatusCode}`
            : result.brdErrorCode) ??
          'page_failed';
        return {
          ok: false,
          url,
          targetStatusCode: result.targetStatusCode,
          error: session.lastError,
          remainingPages: Math.max(0, session.maxPages - session.pageCalls),
        };
      }
      session.pageHtml.set(url, result.html);
      return {
        ok: true,
        url,
        textPreview: htmlToTextPreview(result.html),
        targetStatusCode: result.targetStatusCode,
        remainingPages: Math.max(0, session.maxPages - session.pageCalls),
      };
    },
  });

  const extract_emails = createTool({
    id: 'extract_emails',
    description:
      'Extract literal emails from a page previously opened with open_page. Does not invent addresses.',
    inputSchema: z.object({
      url: z.string().url(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      url: z.string(),
      emails: z.array(z.string()),
      error: z.string().optional(),
      totalUniqueEmails: z.number().int(),
    }),
    execute: async ({ url }) => {
      const html = session.pageHtml.get(url);
      if (!html) {
        return {
          ok: false,
          url,
          emails: [],
          error: 'Page not opened yet — call open_page first for this URL',
          totalUniqueEmails: session.emails.size,
        };
      }
      const found = extractEmailsFromHtml(html);
      for (const email of found) {
        if (!session.emails.has(email)) {
          session.emails.set(email, {
            email,
            sourceUrl: url,
            evidenceSnippet: evidenceSnippetAroundEmail(html, email),
          });
        }
      }
      return {
        ok: true,
        url,
        emails: found,
        totalUniqueEmails: session.emails.size,
      };
    },
  });

  return { search_web, open_page, extract_emails };
}
