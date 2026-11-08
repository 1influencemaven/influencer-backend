import { parseOrganicHits } from './parse-organics';
import type { BrightDataPageResult, BrightDataSerpResult } from './types';

const BASE_URL = 'https://api.brightdata.com';

export type BrightDataClientConfig = {
  apiKey: string;
  serpZone: string;
  unlockerZone: string;
  timeoutMs: number;
};

function pickBrd(headers: Headers): {
  brdError?: string;
  brdErrorCode?: string;
  brdStatusCode?: string;
} {
  return {
    brdError: headers.get('x-brd-error') ?? undefined,
    brdErrorCode:
      headers.get('x-brd-error-code') ??
      headers.get('x-brd-err-code') ??
      undefined,
    brdStatusCode: headers.get('x-brd-status-code') ?? undefined,
  };
}

export class BrightDataToolsClient {
  constructor(private readonly config: BrightDataClientConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.apiKey && this.config.serpZone && this.config.unlockerZone,
    );
  }

  async searchWeb(query: string, num = 8): Promise<BrightDataSerpResult> {
    // Avoid `num` in Google URL — Bright Data often strips/rejects it.
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
      query,
    )}&hl=en&gl=us`;
    const started = Date.now();

    try {
      const response = await fetch(`${BASE_URL}/request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/html, application/json;q=0.9, */*;q=0.8',
        },
        body: JSON.stringify({
          zone: this.config.serpZone,
          url: googleUrl,
          format: 'raw',
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const html = await response.text();
      const brd = pickBrd(response.headers);
      const emptyBody = html.length === 0;
      const organics =
        !emptyBody && !brd.brdError ? parseOrganicHits(html, num) : [];

      return {
        ok:
          response.ok &&
          !emptyBody &&
          !brd.brdError &&
          Number(brd.brdStatusCode ?? '200') < 400,
        httpStatus: response.status,
        bodyLength: html.length,
        elapsedMs: Date.now() - started,
        organics,
        emptyBody,
        ...brd,
      };
    } catch (error) {
      return {
        ok: false,
        httpStatus: 0,
        bodyLength: 0,
        elapsedMs: Date.now() - started,
        organics: [],
        emptyBody: true,
        brdError: error instanceof Error ? error.message : String(error),
        brdErrorCode: 'network_error',
      };
    }
  }

  async openPage(url: string): Promise<BrightDataPageResult> {
    const started = Date.now();
    try {
      const response = await fetch(`${BASE_URL}/request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/html, application/json;q=0.9, */*;q=0.8',
        },
        body: JSON.stringify({
          zone: this.config.unlockerZone,
          url,
          format: 'raw',
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const html = await response.text();
      const brd = pickBrd(response.headers);
      const emptyBody = html.length === 0;
      const targetStatusCode = brd.brdStatusCode
        ? Number(brd.brdStatusCode)
        : undefined;

      return {
        ok:
          response.ok &&
          !emptyBody &&
          !brd.brdError &&
          (targetStatusCode === undefined || targetStatusCode < 400),
        httpStatus: response.status,
        targetStatusCode:
          targetStatusCode !== undefined && !Number.isNaN(targetStatusCode)
            ? targetStatusCode
            : undefined,
        bodyLength: html.length,
        elapsedMs: Date.now() - started,
        html: emptyBody ? '' : html,
        emptyBody,
        ...brd,
      };
    } catch (error) {
      return {
        ok: false,
        httpStatus: 0,
        bodyLength: 0,
        elapsedMs: Date.now() - started,
        html: '',
        emptyBody: true,
        brdError: error instanceof Error ? error.message : String(error),
        brdErrorCode: 'network_error',
      };
    }
  }
}
