/**
 * Paso 1 — Smoke Bright Data SIN IA (SERP + Unlocker).
 *
 * Uso (desde influencer-backend):
 *   node scripts/smoke-brightdata-tools.mjs
 *   node scripts/smoke-brightdata-tools.mjs --domain lightartsy.com --page https://lightartsy.com/contact
 *
 * Lee BRIGHTDATA_* desde .env. No imprime la API key ni HTML completo.
 * Siempre reporta headers x-brd-* (Bright Data suele devolver HTTP 200 con body vacío).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const BASE_URL = 'https://api.brightdata.com';

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function parseArgs(argv) {
  const out = {
    domain: 'lightartsy.com',
    page: 'https://lightartsy.com/contact',
    query: null,
    num: 8,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--domain') out.domain = argv[++i];
    else if (a === '--page') out.page = argv[++i];
    else if (a === '--query') out.query = argv[++i];
    else if (a === '--num') out.num = Number(argv[++i]) || 8;
  }
  if (!out.query) {
    out.query = `site:${out.domain} (contact OR partnerships OR press OR creators) email`;
  }
  return out;
}

function preview(text, max = 180) {
  return text
    .slice(0, max)
    .replace(/\s+/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

function extractEmails(html) {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const found = html.match(re) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))].filter(
    (e) =>
      !e.endsWith('.png') &&
      !e.endsWith('.jpg') &&
      !e.includes('example.com'),
  );
}

function countOrganicHints(html) {
  const hrefs = [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map(
    (m) => m[1],
  );
  const external = hrefs.filter((u) => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return (
        !h.includes('google.') &&
        !h.includes('gstatic.') &&
        !h.includes('youtube.')
      );
    } catch {
      return false;
    }
  });
  return {
    hrefTotal: hrefs.length,
    externalHrefSample: [...new Set(external)].slice(0, 8),
    looksLikeHtml: /<html[\s>]/i.test(html) || /<!doctype html/i.test(html),
    hasConsent: /consent\.google|before you continue/i.test(html),
    looksLikeSerp: /SearchResultsPage|organic|class="g"/i.test(html),
  };
}

function pickBrdHeaders(headers) {
  const out = {};
  for (const [k, v] of headers) {
    if (/^x-brd|^x-luminati|^cf-/i.test(k) || k === 'content-type') {
      out[k] = v;
    }
  }
  return out;
}

async function postRequest({ apiKey, zone, url, dataFormat }) {
  const body = {
    zone,
    url,
    format: 'raw',
  };
  if (dataFormat) body.data_format = dataFormat;

  const started = Date.now();
  let response;
  try {
    response = await fetch(`${BASE_URL}/request`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/html, application/json;q=0.9, */*;q=0.8',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      elapsedMs: Date.now() - started,
      bodyLength: 0,
      body: '',
      brdHeaders: {},
      networkError: {
        name: err?.name,
        message: String(err?.message ?? err).slice(0, 200),
        causeCode: err?.cause?.code,
        causeHostname: err?.cause?.hostname,
      },
    };
  }

  const text = await response.text();
  return {
    ok: response.ok,
    httpStatus: response.status,
    elapsedMs: Date.now() - started,
    bodyLength: text.length,
    body: text,
    brdHeaders: pickBrdHeaders(response.headers),
    networkError: null,
  };
}

function reportHttp(label, result, { emails = false } = {}) {
  const base = {
    label,
    httpStatus: result.httpStatus,
    elapsedMs: result.elapsedMs,
    bodyLength: result.bodyLength,
    emptyBody: result.bodyLength === 0,
    brdHeaders: result.brdHeaders,
    networkError: result.networkError,
    preview: result.bodyLength ? preview(result.body) : '',
  };
  if (result.bodyLength) {
    Object.assign(base, countOrganicHints(result.body));
  }
  if (emails && result.bodyLength) {
    const list = extractEmails(result.body);
    base.emailCount = list.length;
    base.emails = list.slice(0, 15);
  }
  console.log(JSON.stringify(base, null, 2));
  return base;
}

async function main() {
  const env = { ...loadEnvFile(resolve(root, '.env')), ...process.env };
  const args = parseArgs(process.argv.slice(2));

  const apiKey = (env.BRIGHTDATA_API_KEY ?? '').trim();
  const serpZone = (env.BRIGHTDATA_SERP_ZONE ?? '').trim();
  const unlockerZone =
    (env.BRIGHTDATA_UNLOCKER_ZONE ?? '').trim() ||
    (env.BRIGHTDATA_ZONE ?? '').trim() ||
    'mcp_unlocker';

  console.log('=== Bright Data tools smoke (no AI) ===');
  console.log(
    JSON.stringify(
      {
        apiKeyPresent: Boolean(apiKey),
        serpZone: serpZone || '(missing)',
        unlockerZone,
        domain: args.domain,
        serpQuery: args.query,
        unlockerPage: args.page,
      },
      null,
      2,
    ),
  );

  if (!apiKey) {
    console.error('FAIL: BRIGHTDATA_API_KEY missing in .env');
    process.exit(1);
  }
  if (!serpZone) {
    console.error(
      'FAIL: BRIGHTDATA_SERP_ZONE missing — SERP must not reuse Unlocker zone',
    );
    process.exit(1);
  }

  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
    args.query,
  )}&hl=en&gl=us&num=${args.num}`;
  // Bright Data SERP may strip `num`; also try a URL without it.
  const googleUrlNoNum = `https://www.google.com/search?q=${encodeURIComponent(
    args.query,
  )}&hl=en&gl=us`;

  console.log('\n--- SERP A: zone=%s data_format=html (Nest path) ---', serpZone);
  const serpA = await postRequest({
    apiKey,
    zone: serpZone,
    url: googleUrl,
    dataFormat: 'html',
  });
  const serpAReport = reportHttp('serp_data_format_html', serpA);

  console.log('\n--- SERP B: zone=%s format=raw only (no data_format) ---', serpZone);
  const serpB = await postRequest({
    apiKey,
    zone: serpZone,
    url: googleUrlNoNum,
  });
  const serpBReport = reportHttp('serp_raw_only', serpB);

  console.log('\n--- Unlocker: zone=%s page=%s ---', unlockerZone, args.page);
  const unlocker = await postRequest({
    apiKey,
    zone: unlockerZone,
    url: args.page,
  });
  const unlockerReport = reportHttp('unlocker', unlocker, { emails: true });

  const serpOk =
    (serpAReport.bodyLength > 500 && !serpAReport.networkError) ||
    (serpBReport.bodyLength > 500 && !serpBReport.networkError);
  const unlockerOk =
    unlockerReport.bodyLength > 0 &&
    !unlockerReport.networkError &&
    unlockerReport.brdHeaders?.['x-brd-error'] !==
      'Auth Failed (code: ip_forbidden)';

  const blockers = [];
  if (serpAReport.emptyBody && serpAReport.brdHeaders?.['x-brd-error-code']) {
    blockers.push(
      `SERP+data_format: ${serpAReport.brdHeaders['x-brd-error-code']} / ${serpAReport.brdHeaders['x-brd-error']}`,
    );
  }
  if (!serpOk) {
    blockers.push('SERP produced no usable HTML in either variant');
  }
  if (unlockerReport.brdHeaders?.['x-brd-error']) {
    blockers.push(
      `Unlocker: ${unlockerReport.brdHeaders['x-brd-error']} (${unlockerReport.brdHeaders['x-brd-err-msg'] ?? unlockerReport.brdHeaders['x-brd-err-code'] ?? ''})`,
    );
  }

  console.log('\n=== Verdict ===');
  console.log(
    JSON.stringify(
      {
        serpUsable: serpOk,
        serpPreferredVariant:
          serpBReport.bodyLength > serpAReport.bodyLength
            ? 'raw_only_no_data_format'
            : 'data_format_html',
        unlockerUsable: unlockerOk,
        blockers,
        next: unlockerOk && serpOk
          ? 'Tools OK — proceed to Paso 2 with client Claude prompt'
          : 'Resolve Bright Data account/zone blockers before Paso 2',
      },
      null,
      2,
    ),
  );

  process.exit(serpOk && unlockerOk ? 0 : 2);
}

main().catch((err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});
