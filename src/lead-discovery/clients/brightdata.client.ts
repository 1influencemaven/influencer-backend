import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type BrightDataRecord = Record<string, unknown>;

export type BrightDataCatalogItem = {
  id: string;
  name: string;
  kind: 'dataset' | 'scraper';
  /** Bright Data `category` when present (e.g. ecomm, business). */
  category?: string;
  /** Bright Data target `domain` when present. */
  domain?: string;
  /** Bright Data `scraper_type` entries when present. */
  scraperTypes?: string[];
};

type SnapshotProgressStatus =
  | 'starting'
  | 'running'
  | 'ready'
  | 'failed'
  | 'canceled';

@Injectable()
export class BrightDataClient {
  private readonly logger = new Logger(BrightDataClient.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.brightdata.com';
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      this.configService.get<string>('BRIGHTDATA_API_KEY')?.trim() ?? '';
    this.pollTimeoutMs =
      this.configService.get<number>('BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS') ??
      120000;
    this.pollIntervalMs =
      this.configService.get<number>('BRIGHTDATA_SCRAPER_POLL_INTERVAL_MS') ??
      3000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Options usable with `/datasets/v3/trigger` (live collection).
   * Marketplace `/datasets/list` entries often return
   * "This dataset does not support collection" and must not be offered in Lead Discovery.
   */
  async listCollectableCatalog(): Promise<BrightDataCatalogItem[]> {
    return this.listScrapers();
  }

  /** @deprecated Prefer listCollectableCatalog for trigger-based Lead Discovery */
  async listCatalog(): Promise<BrightDataCatalogItem[]> {
    return this.listCollectableCatalog();
  }

  async triggerAndCollect(
    datasetId: string,
    inputs: Record<string, unknown>[],
  ): Promise<BrightDataRecord[]> {
    const response = await fetch(
      `${this.baseUrl}/datasets/v3/trigger?dataset_id=${encodeURIComponent(datasetId)}&format=json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inputs),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `BrightData trigger failed: ${response.status} ${body}`,
      );
      throw new Error(
        `BrightData request failed with status ${response.status}`,
      );
    }

    const payload: unknown = await response.json();

    if (Array.isArray(payload)) {
      return payload as BrightDataRecord[];
    }

    if (payload && typeof payload === 'object') {
      const asRecord = payload as Record<string, unknown>;
      if (Array.isArray(asRecord.data)) {
        return asRecord.data as BrightDataRecord[];
      }
      if (typeof asRecord.snapshot_id === 'string') {
        return this.pollSnapshot(asRecord.snapshot_id, datasetId);
      }
    }

    this.logger.warn('Unexpected BrightData response shape; returning empty');
    return [];
  }

  private async listScrapers(): Promise<BrightDataCatalogItem[]> {
    try {
      const response = await fetch(`${this.baseUrl}/datasets/v3/scrapers`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) {
        this.logger.warn(`scrapers list failed: ${response.status}`);
        return [];
      }
      const payload: unknown = await response.json();
      return this.mapCatalog(payload, 'scraper');
    } catch (error) {
      this.logger.warn(`scrapers list error: ${String(error)}`);
      return [];
    }
  }

  private mapCatalog(
    payload: unknown,
    kind: 'dataset' | 'scraper',
  ): BrightDataCatalogItem[] {
    const list = Array.isArray(payload)
      ? payload
      : payload &&
          typeof payload === 'object' &&
          Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : [];

    return list
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const record = item as Record<string, unknown>;
        const id = String(record.id ?? record.dataset_id ?? '').trim();
        const name = String(
          record.name ?? record.title ?? record.dataset_name ?? id,
        ).trim();
        if (!id) {
          return null;
        }
        const category = String(record.category ?? '')
          .trim()
          .toLowerCase();
        const domain = String(record.domain ?? '')
          .trim()
          .toLowerCase();
        const scraperTypes = Array.isArray(record.scraper_type)
          ? record.scraper_type.map((value) => String(value).trim()).filter(Boolean)
          : undefined;
        return {
          id,
          name: name || id,
          kind,
          ...(category ? { category } : {}),
          ...(domain ? { domain } : {}),
          ...(scraperTypes && scraperTypes.length > 0
            ? { scraperTypes }
            : {}),
        };
      })
      .filter((item): item is BrightDataCatalogItem => item !== null);
  }

  private async pollSnapshot(
    snapshotId: string,
    scraperId: string,
  ): Promise<BrightDataRecord[]> {
    const startMs = Date.now();
    const deadline = startMs + this.pollTimeoutMs;
    let pollAttempt = 0;

    while (Date.now() < deadline) {
      pollAttempt += 1;
      const elapsedMs = Date.now() - startMs;

      const progress = await this.fetchSnapshotProgress(snapshotId);
      const status = progress.status;

      this.logPollEvent({
        snapshotId,
        scraperId,
        status,
        pollAttempt,
        elapsedMs,
      });

      if (status === 'ready') {
        this.logPollEvent({
          snapshotId,
          scraperId,
          status: 'ready',
          elapsedMs: Date.now() - startMs,
        });
        return this.downloadSnapshot(snapshotId);
      }

      if (status === 'failed') {
        throw new Error(
          `BrightData snapshot failed (snapshot_id=${snapshotId})`,
        );
      }

      if (status === 'canceled') {
        throw new Error(
          `BrightData snapshot canceled (snapshot_id=${snapshotId})`,
        );
      }

      if (status !== 'starting' && status !== 'running') {
        this.logger.warn(
          `Unexpected Bright Data snapshot status "${status}" for ${snapshotId}`,
        );
      }

      if (Date.now() + this.pollIntervalMs > deadline) {
        break;
      }
      await this.sleep(this.pollIntervalMs);
    }

    const elapsedMs = Date.now() - startMs;
    this.logPollEvent({
      snapshotId,
      scraperId,
      status: 'timeout',
      elapsedMs,
    });
    throw new Error('BrightData snapshot polling timed out');
  }

  private async fetchSnapshotProgress(snapshotId: string): Promise<{
    status: SnapshotProgressStatus | 'unknown';
  }> {
    const response = await fetch(
      `${this.baseUrl}/datasets/v3/progress/${encodeURIComponent(snapshotId)}`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `BrightData progress request failed: ${response.status} ${body}`,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const rawStatus = String(payload.status ?? '').toLowerCase();
    const status = this.normalizeProgressStatus(rawStatus);
    return { status };
  }

  private normalizeProgressStatus(
    raw: string,
  ): SnapshotProgressStatus | 'unknown' {
    if (
      raw === 'starting' ||
      raw === 'running' ||
      raw === 'ready' ||
      raw === 'failed' ||
      raw === 'canceled'
    ) {
      return raw;
    }
    return 'unknown';
  }

  private async downloadSnapshot(snapshotId: string): Promise<BrightDataRecord[]> {
    const response = await fetch(
      `${this.baseUrl}/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      },
    );

    if (response.status === 202) {
      throw new Error(
        `BrightData snapshot not ready for download (snapshot_id=${snapshotId})`,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `BrightData snapshot download failed: ${response.status} ${body}`,
      );
    }

    const text = await response.text();
    try {
      const data = JSON.parse(text) as unknown;
      if (Array.isArray(data)) {
        return data as BrightDataRecord[];
      }
      if (data && typeof data === 'object') {
        return [data as BrightDataRecord];
      }
      return [];
    } catch {
      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        return [];
      }
      return lines.map((line) => JSON.parse(line) as BrightDataRecord);
    }
  }

  private logPollEvent(event: {
    snapshotId: string;
    scraperId: string;
    status: string;
    pollAttempt?: number;
    elapsedMs: number;
  }): void {
    this.logger.log(
      JSON.stringify({
        event: 'brightdata_snapshot_poll',
        snapshotId: event.snapshotId,
        scraperId: event.scraperId,
        status: event.status,
        pollAttempt: event.pollAttempt,
        elapsedMs: event.elapsedMs,
      }),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
