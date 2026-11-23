import { parseOrganicHits } from './parse-organics';
import type { BrightDataPageResult, BrightDataSerpResult } from './types';

const BASE_URL = 'https://api.brightdata.com';

export type BrightDataClientConfig = {
  apiKey: string;
  serpZone: string;
  unlockerZone: string;
  timeoutMs: number;
  linkedInPeopleDatasetId?: string;
  scraperPollTimeoutMs?: number;
  scraperPollIntervalMs?: number;
};

export type SearchWebOptions = {
  /** Google country (`gl`), default `us`. */
  gl?: string;
  /** Google interface language (`hl`), default `en`. */
  hl?: string;
  /** Extra attempts after an empty body / provider rejection (default 1). */
  retries?: number;
  /** Wait before retrying: Bright Data bans an identical failed query for ~15 s. */
  cooldownMs?: number;
};

export const SERP_RETRY_COOLDOWN_MS = 15_000;

function isRetryableSerp(result: BrightDataSerpResult): boolean {
  if (result.ok) return false;
  const code = (result.brdErrorCode ?? '').toLowerCase();
  return (
    result.emptyBody ||
    result.httpStatus === 429 ||
    code.includes('rate_limit') ||
    code.includes('rejected')
  );
}

export type LinkedInPeopleScrapeResult = {
  ok: boolean;
  url: string;
  name?: string;
  title?: string;
  about?: string;
  raw?: Record<string, unknown>;
  error?: string;
  /** Any email-like fields present on the dataset row (usually empty). */
  emailFields: string[];
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

  /**
   * SERP search with market-aware `gl`/`hl` and one cooldown retry on empty
   * body / 429 / rejection (parity with the Nest client).
   */
  async searchWeb(
    query: string,
    num = 8,
    options: SearchWebOptions = {},
  ): Promise<BrightDataSerpResult> {
    const retries = options.retries ?? 1;
    const cooldownMs = options.cooldownMs ?? SERP_RETRY_COOLDOWN_MS;
    let result = await this.searchWebOnce(query, num, options);
    for (let attempt = 0; attempt < retries && isRetryableSerp(result); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, cooldownMs));
      result = await this.searchWebOnce(query, num, options);
    }
    return result;
  }

  private async searchWebOnce(
    query: string,
    num: number,
    options: SearchWebOptions,
  ): Promise<BrightDataSerpResult> {
    const hl = options.hl ?? 'en';
    const gl = options.gl ?? 'us';
    // `brd_json=1` → Bright Data parsed organics (avoids Google consent HTML).
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
      query,
    )}&hl=${hl}&gl=${gl}&brd_json=1`;
    const started = Date.now();

    try {
      const response = await fetch(`${BASE_URL}/request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
        },
        body: JSON.stringify({
          zone: this.config.serpZone,
          url: googleUrl,
          format: 'raw',
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const bodyText = await response.text();
      const brd = pickBrd(response.headers);
      const emptyBody = bodyText.length === 0;
      const organics =
        !emptyBody && !brd.brdError ? parseOrganicHits(bodyText, num) : [];

      return {
        ok:
          response.ok &&
          !emptyBody &&
          !brd.brdError &&
          Number(brd.brdStatusCode ?? '200') < 400,
        httpStatus: response.status,
        bodyLength: bodyText.length,
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

  /**
   * Live-collect one LinkedIn people profile via Bright Data dataset trigger.
   * Dataset default: gd_l1viktl72bvl7bjuj0 (no email fields in typical account).
   */
  async scrapeLinkedInProfile(url: string): Promise<LinkedInPeopleScrapeResult> {
    const datasetId =
      this.config.linkedInPeopleDatasetId?.trim() || 'gd_l1viktl72bvl7bjuj0';
    const pollTimeoutMs = this.config.scraperPollTimeoutMs ?? 120_000;
    const pollIntervalMs = this.config.scraperPollIntervalMs ?? 3_000;

    try {
      const trigger = await fetch(
        `${BASE_URL}/datasets/v3/trigger?dataset_id=${encodeURIComponent(datasetId)}&format=json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([{ url }]),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
      const triggerText = await trigger.text();
      if (!trigger.ok) {
        return {
          ok: false,
          url,
          error: `trigger ${trigger.status}: ${triggerText.slice(0, 200)}`,
          emailFields: [],
        };
      }

      let snapshotId: string | null = null;
      try {
        const parsed: unknown = JSON.parse(triggerText);
        if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
          return this.mapLinkedInRow(url, parsed[0] as Record<string, unknown>);
        }
        if (parsed && typeof parsed === 'object') {
          const rec = parsed as Record<string, unknown>;
          if (typeof rec.snapshot_id === 'string') snapshotId = rec.snapshot_id;
          else if (Array.isArray(rec.data) && rec.data[0]) {
            return this.mapLinkedInRow(
              url,
              rec.data[0] as Record<string, unknown>,
            );
          }
        }
      } catch {
        return {
          ok: false,
          url,
          error: `trigger parse failed: ${triggerText.slice(0, 120)}`,
          emailFields: [],
        };
      }

      if (!snapshotId) {
        return {
          ok: false,
          url,
          error: 'trigger response missing snapshot_id',
          emailFields: [],
        };
      }

      const deadline = Date.now() + pollTimeoutMs;
      while (Date.now() < deadline) {
        await sleep(pollIntervalMs);
        const progress = await fetch(
          `${BASE_URL}/datasets/v3/progress/${encodeURIComponent(snapshotId)}`,
          {
            headers: { Authorization: `Bearer ${this.config.apiKey}` },
            signal: AbortSignal.timeout(this.config.timeoutMs),
          },
        );
        if (!progress.ok) {
          return {
            ok: false,
            url,
            error: `progress ${progress.status}`,
            emailFields: [],
          };
        }
        const progJson = (await progress.json()) as { status?: string };
        const status = String(progJson.status ?? '').toLowerCase();
        if (status === 'ready') {
          const snap = await fetch(
            `${BASE_URL}/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`,
            {
              headers: { Authorization: `Bearer ${this.config.apiKey}` },
              signal: AbortSignal.timeout(this.config.timeoutMs),
            },
          );
          const snapText = await snap.text();
          if (!snap.ok) {
            return {
              ok: false,
              url,
              error: `snapshot ${snap.status}: ${snapText.slice(0, 200)}`,
              emailFields: [],
            };
          }
          const rows: unknown = JSON.parse(snapText);
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (!row || typeof row !== 'object') {
            return {
              ok: false,
              url,
              error: 'empty snapshot',
              emailFields: [],
            };
          }
          return this.mapLinkedInRow(url, row as Record<string, unknown>);
        }
        if (status === 'failed' || status === 'canceled') {
          return {
            ok: false,
            url,
            error: `snapshot ${status}`,
            emailFields: [],
          };
        }
      }
      return { ok: false, url, error: 'snapshot poll timeout', emailFields: [] };
    } catch (error) {
      return {
        ok: false,
        url,
        error: error instanceof Error ? error.message : String(error),
        emailFields: [],
      };
    }
  }

  private mapLinkedInRow(
    inputUrl: string,
    row: Record<string, unknown>,
  ): LinkedInPeopleScrapeResult {
    const name =
      stringField(row, 'name') ||
      [stringField(row, 'first_name'), stringField(row, 'last_name')]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      undefined;
    const title =
      stringField(row, 'position') ||
      stringField(row, 'headline') ||
      undefined;
    const about = stringField(row, 'about') || undefined;
    const profileUrl = stringField(row, 'url') || inputUrl;
    const emailFields: string[] = [];
    for (const [key, value] of Object.entries(row)) {
      if (!/email/i.test(key)) continue;
      if (typeof value === 'string' && value.includes('@')) {
        emailFields.push(value.trim().toLowerCase());
      }
    }
    return {
      ok: Boolean(name || title || about),
      url: profileUrl,
      name,
      title,
      about,
      raw: row,
      emailFields: [...new Set(emailFields)],
    };
  }
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const v = row[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
