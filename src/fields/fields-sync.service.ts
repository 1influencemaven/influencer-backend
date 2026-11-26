import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import type {
  CustomField,
  CustomFieldSyncTrigger,
  Prisma,
} from '../generated/prisma/client';
import {
  SALESHANDY_ERROR_CODES,
  SaleshandyApiException,
} from '../integrations/saleshandy/saleshandy.errors';
import { SaleshandyHttpService } from '../integrations/saleshandy/saleshandy-http.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseRemoteFields,
  slugifyKey,
  toLocalFieldType,
  uniqueKey,
  type RemoteField,
} from './fields.mapper';

/** Serializes concurrent syncs (pg advisory lock key, arbitrary constant). */
const FIELDS_SYNC_LOCK_KEY = 874_210_551;

/**
 * A response with far fewer system fields than we already know is treated as
 * partial (system fields are never removed in bulk) and rejected.
 */
const MIN_SYSTEM_RATIO = 0.8;

export const FIELDS_SYNC_ERROR = {
  INVALID_RESPONSE: 'FIELDS_SYNC_INVALID_RESPONSE',
  PARTIAL_RESPONSE: 'FIELDS_SYNC_PARTIAL_RESPONSE',
} as const;

export type FieldsSyncSummary = {
  runId: string;
  status: 'COMPLETED';
  trigger: CustomFieldSyncTrigger;
  remote: number;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  reactivated: number;
  skipped: number;
  syncedAt: string;
};

type Tx = Prisma.TransactionClient;

function sameTags(a: string[], b: string[]) {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * HU-FLD-005: imports the Saleshandy field catalog into `CustomField`.
 * - Upsert by `saleshandyFieldId` (fallback: same `key` on an unlinked row).
 * - Never overwrites `fallbackText` / `metadata` (Saleshandy does not return them).
 * - Fields missing remotely are disabled (`REMOVED_IN_SALESHANDY`), never deleted.
 * - Admin-disabled fields stay disabled.
 * - Any API error or malformed / partial payload aborts without touching local data.
 */
@Injectable()
export class FieldsSyncService {
  private readonly logger = new Logger(FieldsSyncService.name);

  constructor(
    private readonly saleshandy: SaleshandyHttpService,
    private readonly prisma: PrismaService,
  ) {}

  isAvailable(): boolean {
    return this.saleshandy.isConfigured();
  }

  async sync(
    trigger: CustomFieldSyncTrigger,
    initiatedById?: string,
  ): Promise<FieldsSyncSummary> {
    const startedAt = new Date();
    try {
      const { payload } = await this.saleshandy.request<unknown>(
        'GET',
        '/fields',
        {
          query: { systemFields: 'true' },
          timeoutMs: 20_000,
        },
      );
      const parsed = parseRemoteFields(payload);
      if (!parsed.ok) {
        throw new SaleshandyApiException(
          SALESHANDY_ERROR_CODES.UNAVAILABLE,
          'Saleshandy returned an unexpected field list; local fields were not changed.',
          HttpStatus.BAD_GATEWAY,
          undefined,
          `${FIELDS_SYNC_ERROR.INVALID_RESPONSE}:${parsed.reason}`,
        );
      }

      const summary = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FIELDS_SYNC_LOCK_KEY})`;
          return this.apply(
            tx,
            parsed.fields,
            parsed.skippedIds,
            trigger,
            startedAt,
            initiatedById,
          );
        },
        { timeout: 30_000 },
      );
      this.logger.log(
        JSON.stringify({
          event: 'saleshandy_fields_sync_completed',
          ...summary,
        }),
      );
      return summary;
    } catch (error) {
      await this.recordFailure(error, trigger, startedAt, initiatedById);
      throw error;
    }
  }

  private async apply(
    tx: Tx,
    remote: RemoteField[],
    skippedIds: string[],
    trigger: CustomFieldSyncTrigger,
    startedAt: Date,
    initiatedById?: string,
  ): Promise<FieldsSyncSummary> {
    const local = await tx.customField.findMany();
    const byRemoteId = new Map<string, CustomField>();
    const unlinkedByKey = new Map<string, CustomField>();
    const takenKeys = new Set<string>();
    for (const field of local) {
      takenKeys.add(field.key.toLowerCase());
      if (field.saleshandyFieldId)
        byRemoteId.set(field.saleshandyFieldId, field);
      else unlinkedByKey.set(field.key.toLowerCase(), field);
    }

    const knownSystem = local.filter(
      (f) => f.origin === 'SYSTEM' && f.isActive,
    ).length;
    const remoteSystem = remote.filter((f) => f.origin === 'SYSTEM').length;
    if (
      remote.length === 0 ||
      (knownSystem > 0 && remoteSystem < knownSystem * MIN_SYSTEM_RATIO)
    ) {
      throw new SaleshandyApiException(
        SALESHANDY_ERROR_CODES.UNAVAILABLE,
        'Saleshandy returned an incomplete field list; local fields were not changed.',
        HttpStatus.BAD_GATEWAY,
        undefined,
        FIELDS_SYNC_ERROR.PARTIAL_RESPONSE,
      );
    }

    const now = new Date();
    const counts = {
      created: 0,
      updated: 0,
      unchanged: 0,
      deactivated: 0,
      reactivated: 0,
    };
    const seen = new Set<string>(skippedIds);

    for (const item of remote) {
      seen.add(item.id);
      const candidateKey = item.systemMapping ?? slugifyKey(item.label);
      const existing =
        byRemoteId.get(item.id) ??
        unlinkedByKey.get(candidateKey.toLowerCase());
      const fieldType = toLocalFieldType(item.fieldType);

      if (!existing) {
        await tx.customField.create({
          data: {
            key: uniqueKey(candidateKey, takenKeys),
            label: item.label,
            fieldType,
            origin: item.origin,
            saleshandyFieldId: item.id,
            systemMapping: item.systemMapping,
            tags: item.tags,
            lastSyncedAt: now,
          },
        });
        counts.created++;
        continue;
      }

      const reactivate =
        !existing.isActive &&
        existing.disabledReason === 'REMOVED_IN_SALESHANDY';
      const data: Prisma.CustomFieldUpdateInput = { lastSyncedAt: now };
      if (existing.saleshandyFieldId !== item.id)
        data.saleshandyFieldId = item.id;
      if (existing.label !== item.label) data.label = item.label;
      if (existing.fieldType !== fieldType) {
        data.fieldType = fieldType;
        this.logger.warn(
          JSON.stringify({
            event: 'saleshandy_field_type_changed',
            fieldId: existing.id,
            from: existing.fieldType,
            to: fieldType,
          }),
        );
      }
      if (existing.origin !== item.origin) data.origin = item.origin;
      if (existing.systemMapping !== item.systemMapping)
        data.systemMapping = item.systemMapping;
      if (!sameTags(existing.tags, item.tags)) data.tags = item.tags;
      if (reactivate) {
        data.isActive = true;
        data.disabledReason = null;
        counts.reactivated++;
      }
      const changed = Object.keys(data).length > 1;
      await tx.customField.update({ where: { id: existing.id }, data });
      if (changed) counts.updated++;
      else counts.unchanged++;
    }

    const removed = local.filter(
      (f) =>
        f.saleshandyFieldId && f.isActive && !seen.has(f.saleshandyFieldId),
    );
    if (removed.length) {
      await tx.customField.updateMany({
        where: { id: { in: removed.map((f) => f.id) } },
        data: { isActive: false, disabledReason: 'REMOVED_IN_SALESHANDY' },
      });
      counts.deactivated = removed.length;
    }

    const run = await tx.customFieldSyncRun.create({
      data: {
        status: 'COMPLETED',
        trigger,
        remoteCount: remote.length + skippedIds.length,
        createdCount: counts.created,
        updatedCount: counts.updated,
        unchangedCount: counts.unchanged,
        deactivatedCount: counts.deactivated,
        initiatedById: initiatedById ?? null,
        startedAt,
        completedAt: now,
      },
    });

    return {
      runId: run.id,
      status: 'COMPLETED',
      trigger,
      remote: remote.length + skippedIds.length,
      ...counts,
      skipped: skippedIds.length,
      syncedAt: now.toISOString(),
    };
  }

  private async recordFailure(
    error: unknown,
    trigger: CustomFieldSyncTrigger,
    startedAt: Date,
    initiatedById?: string,
  ) {
    const known = error instanceof SaleshandyApiException;
    const errorCode = known
      ? (error.upstreamCode ?? error.code)
      : 'FIELDS_SYNC_FAILED';
    const errorMessage =
      error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
    this.logger.error(
      JSON.stringify({
        event: 'saleshandy_fields_sync_failed',
        trigger,
        errorCode,
        errorMessage,
      }),
    );
    try {
      await this.prisma.customFieldSyncRun.create({
        data: {
          status: 'FAILED',
          trigger,
          errorCode,
          errorMessage,
          initiatedById: initiatedById ?? null,
          startedAt,
          completedAt: new Date(),
        },
      });
    } catch (logError) {
      this.logger.error(
        JSON.stringify({
          event: 'saleshandy_fields_sync_audit_failed',
          reason:
            logError instanceof Error ? logError.message : String(logError),
        }),
      );
    }
  }
}
