/**
 * Paso 2 smoke — Bright Data tools used by Contact Research (no Nest).
 *
 * From packages/influencer-ai:
 *   npx tsx src/scripts/contact-research-tools-smoke.ts
 *   npx tsx src/scripts/contact-research-tools-smoke.ts --with-llm
 *
 * Loads influencer-backend/.env for BRIGHTDATA_* and AI_* .
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AiExecutionRequest } from '@influence-maven/ai-contracts';

import { BrightDataToolsClient } from '../brightdata/client';
import {
  evidenceSnippetAroundEmail,
  extractEmailsFromHtml,
} from '../brightdata/extract-emails';
import { ContactResearchToolSession } from '../brightdata/session';
import { loadInfluencerAiEnv } from '../config/env';
import { runContactResearchFindBrandEmails } from '../contact-research/run-find-brand-emails';

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  const backendRoot = resolve(__dirname, '../../../..');
  loadDotEnv(resolve(backendRoot, '.env'));
  const withLlm = process.argv.includes('--with-llm');

  const env = loadInfluencerAiEnv();
  const client = new BrightDataToolsClient({
    apiKey: env.brightDataApiKey ?? '',
    serpZone: env.brightDataSerpZone ?? '',
    unlockerZone: env.brightDataUnlockerZone ?? 'mcp_unlocker',
    timeoutMs: env.brightDataTimeoutMs,
  });

  console.log(
    JSON.stringify(
      {
        configured: client.isConfigured(),
        serpZone: env.brightDataSerpZone,
        unlockerZone: env.brightDataUnlockerZone,
        withLlm,
      },
      null,
      2,
    ),
  );

  if (!client.isConfigured()) {
    console.error('Bright Data not configured');
    process.exit(1);
  }

  const session = new ContactResearchToolSession({
    brandName: 'Light Artsy',
    website: 'https://lightartsy.com',
    domain: 'lightartsy.com',
    maxSerpQueries: 2,
    maxPages: 2,
  });

  console.log('\n--- searchWeb (tool backend) ---');
  const search = await client.searchWeb(
    'site:lightartsy.com contact OR partnerships OR press',
  );
  console.log(
    JSON.stringify(
      {
        ok: search.ok,
        bodyLength: search.bodyLength,
        brdError: search.brdError,
        brdErrorCode: search.brdErrorCode,
        organics: search.organics.slice(0, 5),
      },
      null,
      2,
    ),
  );
  session.serpCalls += 1;
  session.queries.push('site:lightartsy.com contact OR partnerships OR press');

  const candidateUrl =
    search.organics.find((o) => session.isAllowedUrl(o.url))?.url ??
    'https://lightartsy.com/';

  console.log('\n--- openPage ---', candidateUrl);
  if (!session.isAllowedUrl(candidateUrl)) {
    console.error('Candidate URL not on brand domain');
    process.exit(2);
  }
  session.pageCalls += 1;
  session.pages.push(candidateUrl);
  const page = await client.openPage(candidateUrl);
  console.log(
    JSON.stringify(
      {
        ok: page.ok,
        bodyLength: page.bodyLength,
        targetStatusCode: page.targetStatusCode,
        brdError: page.brdError,
        preview: page.html.slice(0, 180).replace(/\s+/g, ' '),
      },
      null,
      2,
    ),
  );
  if (page.html) session.pageHtml.set(candidateUrl, page.html);

  const emails = extractEmailsFromHtml(page.html);
  for (const email of emails) {
    session.emails.set(email, {
      email,
      sourceUrl: candidateUrl,
      evidenceSnippet: evidenceSnippetAroundEmail(page.html, email),
    });
  }
  console.log(
    JSON.stringify(
      {
        emails: session.listEmails(),
        trace: session.toTrace(),
      },
      null,
      2,
    ),
  );

  if (withLlm) {
    console.log('\n--- agent FIND_BRAND_EMAILS ---');
    const request = {
      contractVersion: '1.0' as const,
      executionId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'smoke-contact',
      requestedAt: new Date().toISOString(),
      type: 'CONTACT_RESEARCH' as const,
      context: {
        userId: 'smoke',
        influencerId: '00000000-0000-4000-8000-000000000099',
        resourceId: '00000000-0000-4000-8000-000000000098',
        resourceType: 'CONTACT_RESEARCH_RUN' as const,
      },
      instructions: { business: '', businessHash: '0'.repeat(16) },
      input: {
        operation: 'FIND_BRAND_EMAILS' as const,
        brandName: 'Light Artsy',
        website: 'https://lightartsy.com',
        domain: 'lightartsy.com',
        niche: 'home decor',
        maxSerpQueries: 3,
        maxPages: 3,
      },
    } satisfies AiExecutionRequest;

    const run = await runContactResearchFindBrandEmails(env, request, {
      client,
    });
    console.log(JSON.stringify(run, null, 2));
    process.exit(run.ok ? 0 : 2);
  }

  process.exit(search.ok || page.ok ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
