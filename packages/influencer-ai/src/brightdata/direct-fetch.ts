import type { BrightDataPageResult } from './types';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Bot walls / JS shells: retry through Unlocker. */
const CHALLENGE =
  /cf-browser-verification|challenge-platform|cf_chl_|just a moment\.\.\.|attention required! \| cloudflare|captcha-delivery|px-captcha|_incapsula_|access denied|enable javascript and cookies|please enable js/i;

const MIN_HTML_BYTES = 1_500;

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(h) ||
    h.includes(':')
  );
}

/**
 * Free first attempt for a public page. Returns:
 * - a successful page (2xx HTML, no challenge),
 * - a definitive miss (404/410 — the guessed path does not exist; no point
 *   paying Unlocker), or
 * - null → caller falls back to Unlocker.
 */
export async function directFetchPage(
  url: string,
  timeoutMs: number,
): Promise<BrightDataPageResult | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) {
    return null;
  }

  const started = Date.now();
  try {
    const response = await fetch(parsed, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const status = response.status;

    if (status === 404 || status === 410) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        httpStatus: status,
        targetStatusCode: status,
        bodyLength: 0,
        elapsedMs: Date.now() - started,
        html: '',
        emptyBody: true,
        brdErrorCode: `target_http_${status}`,
        via: 'direct',
      };
    }
    if (status < 200 || status >= 300) return null;

    const type = response.headers.get('content-type') ?? '';
    if (type && !/html|xml/i.test(type)) return null;

    const html = await response.text();
    if (html.length < MIN_HTML_BYTES || CHALLENGE.test(html.slice(0, 20_000))) {
      return null;
    }
    return {
      ok: true,
      httpStatus: status,
      targetStatusCode: status,
      bodyLength: html.length,
      elapsedMs: Date.now() - started,
      html,
      emptyBody: false,
      via: 'direct',
    };
  } catch {
    return null;
  }
}
