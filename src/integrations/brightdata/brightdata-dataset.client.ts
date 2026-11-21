import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE_URL = 'https://api.brightdata.com';

export type BrightDataDatasetScrapeResult = {
  ok: boolean;
  url: string;
  row?: Record<string, unknown>;
  error?: string;
  errorCode?:
    | 'not_configured'
    | 'trigger_failed'
    | 'parse_failed'
    | 'progress_failed'
    | 'snapshot_failed'
    | 'empty_snapshot'
    | 'snapshot_failed_status'
    | 'timeout'
    | 'network_error';
};

/**
 * Nest-only Bright Data Datasets API (trigger → poll → snapshot).
 * Used by Talent Manager Instagram research; credentials never leave Nest.
 */
@Injectable()
export class BrightDataDatasetClient {
  private readonly logger = new Logger(BrightDataDatasetClient.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>('BRIGHTDATA_API_KEY')?.trim());
  }

  async scrapeByUrl(params: {
    datasetId: string;
    url: string;
  }): Promise<BrightDataDatasetScrapeResult> {
    const apiKey = this.configService.get<string>('BRIGHTDATA_API_KEY')?.trim();
    if (!apiKey) {
      return {
        ok: false,
        url: params.url,
        error: 'Bright Data API key is not configured',
        errorCode: 'not_configured',
      };
    }

    const timeoutMs =
      this.configService.get<number>('BRIGHTDATA_SEARCH_TIMEOUT_MS') ?? 60_000;
    const pollTimeoutMs =
      this.configService.get<number>('BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS') ??
      120_000;
    const pollIntervalMs =
      this.configService.get<number>('BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS') ??
      3_000;

    try {
      const trigger = await fetch(
        `${BASE_URL}/datasets/v3/trigger?dataset_id=${encodeURIComponent(params.datasetId)}&format=json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([{ url: params.url }]),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      const triggerText = await trigger.text();
      if (!trigger.ok) {
        this.logger.warn({
          event: 'brightdata_dataset_trigger_failed',
          status: trigger.status,
          datasetId: params.datasetId,
        });
        return {
          ok: false,
          url: params.url,
          error: `trigger ${trigger.status}`,
          errorCode: 'trigger_failed',
        };
      }

      let snapshotId: string | null = null;
      try {
        const parsed: unknown = JSON.parse(triggerText);
        if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
          return {
            ok: true,
            url: params.url,
            row: parsed[0] as Record<string, unknown>,
          };
        }
        if (parsed && typeof parsed === 'object') {
          const rec = parsed as Record<string, unknown>;
          if (typeof rec.snapshot_id === 'string') {
            snapshotId = rec.snapshot_id;
          } else if (Array.isArray(rec.data) && rec.data[0]) {
            return {
              ok: true,
              url: params.url,
              row: rec.data[0] as Record<string, unknown>,
            };
          }
        }
      } catch {
        return {
          ok: false,
          url: params.url,
          error: 'trigger parse failed',
          errorCode: 'parse_failed',
        };
      }

      if (!snapshotId) {
        return {
          ok: false,
          url: params.url,
          error: 'trigger response missing snapshot_id',
          errorCode: 'parse_failed',
        };
      }

      const deadline = Date.now() + pollTimeoutMs;
      while (Date.now() < deadline) {
        await sleep(pollIntervalMs);
        const progress = await fetch(
          `${BASE_URL}/datasets/v3/progress/${encodeURIComponent(snapshotId)}`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
        if (!progress.ok) {
          return {
            ok: false,
            url: params.url,
            error: `progress ${progress.status}`,
            errorCode: 'progress_failed',
          };
        }
        const progJson = (await progress.json()) as { status?: string };
        const status = String(progJson.status ?? '').toLowerCase();
        if (status === 'ready') {
          const snap = await fetch(
            `${BASE_URL}/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`,
            {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(timeoutMs),
            },
          );
          const snapText = await snap.text();
          if (!snap.ok) {
            return {
              ok: false,
              url: params.url,
              error: `snapshot ${snap.status}`,
              errorCode: 'snapshot_failed',
            };
          }
          const rows: unknown = JSON.parse(snapText);
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (!row || typeof row !== 'object') {
            return {
              ok: false,
              url: params.url,
              error: 'empty snapshot',
              errorCode: 'empty_snapshot',
            };
          }
          return {
            ok: true,
            url: params.url,
            row: row as Record<string, unknown>,
          };
        }
        if (status === 'failed' || status === 'canceled') {
          return {
            ok: false,
            url: params.url,
            error: `snapshot ${status}`,
            errorCode: 'snapshot_failed_status',
          };
        }
      }

      return {
        ok: false,
        url: params.url,
        error: 'snapshot poll timeout',
        errorCode: 'timeout',
      };
    } catch (error) {
      this.logger.warn({
        event: 'brightdata_dataset_network_error',
        datasetId: params.datasetId,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        url: params.url,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'network_error',
      };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
