import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type BrightDataRecord = Record<string, unknown>;

export type BrightDataCatalogItem = {
  id: string;
  name: string;
  kind: 'dataset' | 'scraper';
};

@Injectable()
export class BrightDataClient {
  private readonly logger = new Logger(BrightDataClient.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.brightdata.com';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('BRIGHTDATA_API_KEY')?.trim() ?? '';
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
      this.logger.error(`BrightData trigger failed: ${response.status} ${body}`);
      throw new Error(`BrightData request failed with status ${response.status}`);
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
        return this.pollSnapshot(asRecord.snapshot_id);
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
        ? ((payload as { data: unknown[] }).data as unknown[])
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
        return { id, name: name || id, kind };
      })
      .filter((item): item is BrightDataCatalogItem => item !== null);
  }

  private async pollSnapshot(snapshotId: string): Promise<BrightDataRecord[]> {
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const response = await fetch(
        `${this.baseUrl}/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        },
      );

      if (response.status === 202) {
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `BrightData snapshot failed: ${response.status} ${body}`,
        );
      }

      const data: unknown = await response.json();
      return Array.isArray(data) ? (data as BrightDataRecord[]) : [];
    }

    throw new Error('BrightData snapshot polling timed out');
  }
}
