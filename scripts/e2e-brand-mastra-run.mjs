/**
 * AI-004.4.8 helper — controlled Brand Discovery Mastra E2E (no secrets logged).
 * Activates a DRAFT IBP for the run only if needed; does not delete data.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const BASE = process.env.E2E_API_BASE || 'http://127.0.0.1:3000/api/v1';
const EMAIL = process.env.E2E_EMAIL || 'admin@test.com';
const PASSWORDS = [
  process.env.E2E_PASSWORD,
  'password',
  'Password1!',
  'Admin123!',
  'admin123',
  'test1234',
  'Test1234!',
].filter(Boolean);

const OUT = path.join(process.cwd(), 'scripts', 'e2e-brand-mastra-last.json');

function cookieHeader(res) {
  const raw = res.headers.getSetCookie?.() || [];
  if (raw.length) {
    return raw.map((c) => c.split(';')[0]).join('; ');
  }
  const single = res.headers.get('set-cookie');
  return single ? single.split(',').map((p) => p.split(';')[0].trim()).join('; ') : '';
}

async function login() {
  for (const password of PASSWORDS) {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password }),
    });
    if (res.ok) {
      const cookies = cookieHeader(res);
      const body = await res.json().catch(() => ({}));
      return { cookies, user: body };
    }
  }
  throw new Error('login_failed_all_passwords');
}

async function ensureActiveIbp(client) {
  const existing = await client.query(`
    SELECT i.id, i.name, ibp.id AS ibp_id, ibp.status::text AS status
    FROM "Influencer" i
    JOIN "IdealBrandProfile" ibp ON ibp."influencerId" = i.id
    WHERE ibp.status = 'ACTIVE'
    LIMIT 1
  `);
  if (existing.rows[0]) {
    return { ...existing.rows[0], activatedForE2e: false };
  }

  const draft = await client.query(`
    SELECT i.id, i.name, ibp.id AS ibp_id, ibp.status::text AS status
    FROM "Influencer" i
    JOIN "IdealBrandProfile" ibp ON ibp."influencerId" = i.id
    WHERE ibp.status = 'DRAFT'
      AND cardinality(ibp."targetSectors") > 0
      AND cardinality(ibp.markets) > 0
    ORDER BY i."updatedAt" DESC NULLS LAST
    LIMIT 1
  `);
  if (!draft.rows[0]) {
    throw new Error('no_draft_ibp_available');
  }

  await client.query(
    `UPDATE "IdealBrandProfile" SET status = 'ACTIVE', "updatedAt" = NOW() WHERE id = $1`,
    [draft.rows[0].ibp_id],
  );
  return { ...draft.rows[0], status: 'ACTIVE', activatedForE2e: true };
}

async function pollRun(cookies, runId, timeoutMs = 420_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}/brand-discovery/runs`, {
      headers: { cookie: cookies },
    });
    if (!res.ok) throw new Error(`list_runs_${res.status}`);
    const runs = await res.json();
    const run = Array.isArray(runs)
      ? runs.find((r) => r.id === runId)
      : null;
    if (run && (run.status === 'COMPLETED' || run.status === 'FAILED')) {
      return run;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('poll_timeout');
}

const report = {
  startedAt: new Date().toISOString(),
  engine: process.env.BRAND_DISCOVERY_ENGINE || null,
  serpZoneConfigured: Boolean(process.env.BRIGHTDATA_SERP_ZONE),
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const ibp = await ensureActiveIbp(client);
  report.influencer = {
    id: ibp.id,
    name: ibp.name,
    ibpId: ibp.ibp_id,
    activatedForE2e: ibp.activatedForE2e,
  };

  const { cookies } = await login();
  report.login = { ok: true, email: EMAIL };

  const t0 = Date.now();
  const searchRes = await fetch(`${BASE}/brand-discovery/search`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookies,
    },
    body: JSON.stringify({ influencerIds: [ibp.id], limit: 5 }),
  });
  const searchBody = await searchRes.json().catch(() => ({}));
  report.searchHttpStatus = searchRes.status;
  report.searchBody = searchBody;

  if (!searchRes.ok) {
    throw new Error(`search_failed_${searchRes.status}`);
  }

  const runId = searchBody.runs?.[0]?.id;
  if (!runId) throw new Error('no_run_id');
  report.runId = runId;
  report.enqueueMs = Date.now() - t0;

  const run = await pollRun(cookies, runId);
  report.finishedAt = new Date().toISOString();
  report.runStatus = run.status;
  report.errorMessage = run.errorMessage ?? null;
  report.searchMetadata = run.searchMetadata ?? null;
  report.totalWallMs = Date.now() - t0;

  const candRes = await fetch(
    `${BASE}/brand-discovery/candidates?runId=${encodeURIComponent(runId)}`,
    { headers: { cookie: cookies } },
  );
  const candidates = await candRes.json().catch(() => []);
  report.candidatesHttpStatus = candRes.status;
  report.candidatesCount = Array.isArray(candidates) ? candidates.length : -1;
  report.candidates = Array.isArray(candidates)
    ? candidates.map((c) => ({
        id: c.id,
        name: c.name,
        website: c.website,
        domain: c.domain,
        score: c.score,
        source: c.source,
        evidenceUrlsCount: Array.isArray(c.evidenceUrls)
          ? c.evidenceUrls.length
          : 0,
        status: c.status,
      }))
    : [];

  const dbRun = await client.query(
    `SELECT id, status::text, "errorMessage", "searchMetadata", "createdAt", "updatedAt"
     FROM "BrandDiscoveryRun" WHERE id = $1`,
    [runId],
  );
  report.dbRun = dbRun.rows[0]
    ? {
        id: dbRun.rows[0].id,
        status: dbRun.rows[0].status,
        errorMessage: dbRun.rows[0].errorMessage,
        searchMetadata: dbRun.rows[0].searchMetadata,
        createdAt: dbRun.rows[0].createdAt,
        updatedAt: dbRun.rows[0].updatedAt,
      }
    : null;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await client.end();
  report.endedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, ...report }, null, 2));
}
