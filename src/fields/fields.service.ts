import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { CustomField, Prisma } from '../generated/prisma/client';
import {
  SALESHANDY_ERROR_CODES,
  SaleshandyApiException,
} from '../integrations/saleshandy/saleshandy.errors';
import { SaleshandyHttpService } from '../integrations/saleshandy/saleshandy-http.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateFieldDto,
  QueryFieldsDto,
  UpdateFieldDto,
} from './dto/fields.dto';
import { FieldsSyncService } from './fields-sync.service';
import {
  buildFieldMetadata,
  normalizeList,
  slugifyKey,
  toFieldDto,
  toLocalFieldType,
  uniqueKey,
  type CustomFieldDto,
} from './fields.mapper';

export const FIELD_ERROR_CODES = {
  SYSTEM_READONLY: 'FIELD_SYSTEM_READONLY',
  SYSTEM_NAME_CONFLICT: 'FIELD_SYSTEM_NAME_CONFLICT',
  LABEL_CONFLICT: 'FIELD_LABEL_CONFLICT',
  INVALID_METADATA: 'FIELD_INVALID_METADATA',
  NOT_LINKED: 'FIELD_NOT_LINKED',
  REMOVED_IN_SALESHANDY: 'FIELD_REMOVED_IN_SALESHANDY',
  NO_CHANGES: 'FIELD_NO_CHANGES',
} as const;

export type FieldsListResponse = {
  data: CustomFieldDto[];
  counts: { all: number; custom: number; system: number; disabled: number };
  availableTags: string[];
  lastSync: Awaited<ReturnType<FieldsService['lastSync']>>;
};

const TYPE_ORDER: Record<string, number> = {
  TEXT: 0,
  LONG_TEXT: 1,
  NUMBER: 2,
  CURRENCY: 3,
  DATE: 4,
  DROPDOWN: 5,
};

/** HU-FLD-002/003/004 + admin enable/disable. Reads come from the local catalog. */
@Injectable()
export class FieldsService {
  private readonly logger = new Logger(FieldsService.name);
  private bootstrapping: Promise<unknown> | null = null;

  constructor(
    private readonly saleshandy: SaleshandyHttpService,
    private readonly prisma: PrismaService,
    private readonly syncService: FieldsSyncService,
  ) {}

  /** First visit with an empty catalog imports it once (errors surface via lastSync). */
  private async bootstrapIfEmpty() {
    if (!this.syncService.isAvailable()) return;
    if ((await this.prisma.customField.count()) > 0) return;
    this.bootstrapping ??= this.syncService
      .sync('BOOTSTRAP')
      .catch(() => undefined)
      .finally(() => {
        this.bootstrapping = null;
      });
    await this.bootstrapping;
  }

  async list(query: QueryFieldsDto): Promise<FieldsListResponse> {
    await this.bootstrapIfEmpty();
    const all = await this.prisma.customField.findMany();

    const counts = {
      all: all.filter((f) => f.isActive).length,
      custom: all.filter((f) => f.isActive && f.origin === 'CUSTOM').length,
      system: all.filter((f) => f.isActive && f.origin === 'SYSTEM').length,
      disabled: all.filter((f) => !f.isActive).length,
    };
    const availableTags = normalizeList(all.flatMap((f) => f.tags)).sort(
      (a, b) => a.localeCompare(b),
    );

    const status = query.status ?? 'active';
    const origin = query.origin ?? 'all';
    const types = query.fieldTypes?.map(toLocalFieldType);
    const tags = query.tags?.map((t) => t.toLowerCase());
    const search = query.search?.trim().toLowerCase();

    const rows = all.filter((f) => {
      if (status === 'active' && !f.isActive) return false;
      if (status === 'disabled' && f.isActive) return false;
      if (origin === 'custom' && f.origin !== 'CUSTOM') return false;
      if (origin === 'system' && f.origin !== 'SYSTEM') return false;
      if (types && !types.includes(f.fieldType)) return false;
      if (tags && !f.tags.some((t) => tags.includes(t.toLowerCase())))
        return false;
      if (
        search &&
        !f.label.toLowerCase().includes(search) &&
        !f.key.toLowerCase().includes(search) &&
        !f.tags.some((t) => t.toLowerCase().includes(search))
      ) {
        return false;
      }
      return true;
    });

    const dir = query.sortOrder === 'desc' ? -1 : 1;
    const sortBy = query.sortBy ?? 'label';
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'fieldType')
        cmp = TYPE_ORDER[a.fieldType] - TYPE_ORDER[b.fieldType];
      else if (sortBy === 'updatedAt')
        cmp = a.updatedAt.getTime() - b.updatedAt.getTime();
      return (cmp || a.label.localeCompare(b.label)) * dir;
    });

    return {
      data: rows.map(toFieldDto),
      counts,
      availableTags,
      lastSync: await this.lastSync(),
    };
  }

  async lastSync() {
    const [last, lastSuccess] = await Promise.all([
      this.prisma.customFieldSyncRun.findFirst({
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.customFieldSyncRun.findFirst({
        where: { status: 'COMPLETED' },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    if (!last) return null;
    return {
      status: last.status,
      trigger: last.trigger,
      at: (last.completedAt ?? last.startedAt).toISOString(),
      errorCode: last.errorCode,
      errorMessage: last.errorMessage,
      lastSuccessAt: lastSuccess?.completedAt?.toISOString() ?? null,
      counts: lastSuccess
        ? {
            created: lastSuccess.createdCount,
            updated: lastSuccess.updatedCount,
            deactivated: lastSuccess.deactivatedCount,
          }
        : null,
    };
  }

  async findOne(id: string): Promise<CustomFieldDto> {
    return toFieldDto(await this.getField(id));
  }

  sync(userId?: string) {
    return this.syncService.sync('MANUAL', userId);
  }

  async syncRuns(limit = 10) {
    const runs = await this.prisma.customFieldSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return runs.map((r) => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      remoteCount: r.remoteCount,
      created: r.createdCount,
      updated: r.updatedCount,
      unchanged: r.unchangedCount,
      deactivated: r.deactivatedCount,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }

  /** HU-FLD-003 */
  async create(dto: CreateFieldDto): Promise<CustomFieldDto> {
    const label = dto.label.trim();
    const built = buildFieldMetadata(dto.fieldType, dto.metadata);
    if ('error' in built) {
      throw new BadRequestException({
        message: built.error,
        code: FIELD_ERROR_CODES.INVALID_METADATA,
      });
    }
    await this.assertLabelAvailable(label);
    const fallbackText = dto.fallbackText?.trim() || undefined;
    const tags = dto.tags !== undefined ? normalizeList(dto.tags) : undefined;

    const { payload } = await this.saleshandy.request<{ id?: unknown } | null>(
      'POST',
      '/fields',
      {
        body: {
          label,
          fieldType: dto.fieldType,
          ...(fallbackText ? { fallbackText } : {}),
          ...(built.metadata ? { metadata: built.metadata } : {}),
          ...(tags?.length ? { tags } : {}),
        },
      },
    );

    const local = {
      label,
      fieldType: toLocalFieldType(dto.fieldType),
      fallbackText: fallbackText ?? null,
      metadata: (built.metadata ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      tags: tags ?? [],
    };

    let remoteId =
      typeof payload?.id === 'string' && payload.id ? payload.id : null;
    if (!remoteId) {
      // Created remotely but no id returned: reconcile through a sync and match by label.
      this.logger.warn(
        JSON.stringify({ event: 'saleshandy_field_create_without_id' }),
      );
      await this.syncService.sync('AFTER_WRITE').catch(() => undefined);
      const synced = await this.prisma.customField.findFirst({
        where: {
          origin: 'CUSTOM',
          label: { equals: label, mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
      });
      remoteId = synced?.saleshandyFieldId ?? null;
      if (!remoteId) {
        throw new SaleshandyApiException(
          SALESHANDY_ERROR_CODES.UNAVAILABLE,
          'Saleshandy did not confirm the new field. Sync and check before retrying.',
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    const taken = new Set(
      (await this.prisma.customField.findMany({ select: { key: true } })).map(
        (f) => f.key.toLowerCase(),
      ),
    );
    const field = await this.prisma.customField.upsert({
      where: { saleshandyFieldId: remoteId },
      create: {
        ...local,
        key: uniqueKey(slugifyKey(label), taken),
        origin: 'CUSTOM',
        saleshandyFieldId: remoteId,
        lastSyncedAt: new Date(),
      },
      update: {
        ...local,
        isActive: true,
        disabledReason: null,
        lastSyncedAt: new Date(),
      },
    });
    return toFieldDto(field);
  }

  /** HU-FLD-004 */
  async update(id: string, dto: UpdateFieldDto): Promise<CustomFieldDto> {
    const field = await this.getField(id);
    this.assertWritable(field);

    const body: { label?: string; fallbackText?: string; tags?: string[] } = {};
    if (dto.label !== undefined && dto.label.trim() !== field.label) {
      body.label = dto.label.trim();
      await this.assertLabelAvailable(body.label, field.id);
    }
    if (
      dto.fallbackText !== undefined &&
      dto.fallbackText.trim() !== (field.fallbackText ?? '')
    ) {
      body.fallbackText = dto.fallbackText.trim();
    }
    if (dto.tags !== undefined) body.tags = normalizeList(dto.tags);
    if (Object.keys(body).length === 0) {
      throw new BadRequestException({
        message: 'Nothing to update.',
        code: FIELD_ERROR_CODES.NO_CHANGES,
      });
    }

    try {
      await this.saleshandy.request(
        'PATCH',
        `/fields/${encodeURIComponent(field.saleshandyFieldId!)}`,
        {
          body,
        },
      );
    } catch (error) {
      if (
        error instanceof SaleshandyApiException &&
        error.code === SALESHANDY_ERROR_CODES.NOT_FOUND
      ) {
        await this.prisma.customField.update({
          where: { id: field.id },
          data: { isActive: false, disabledReason: 'REMOVED_IN_SALESHANDY' },
        });
        throw new NotFoundException({
          message:
            'This field no longer exists in Saleshandy. It was disabled here.',
          code: FIELD_ERROR_CODES.REMOVED_IN_SALESHANDY,
        });
      }
      throw error;
    }

    const updated = await this.prisma.customField.update({
      where: { id: field.id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.fallbackText !== undefined
          ? { fallbackText: body.fallbackText || null }
          : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        lastSyncedAt: new Date(),
      },
    });
    return toFieldDto(updated);
  }

  /** Local enable/disable (Saleshandy has no delete). System fields cannot be disabled. */
  async setStatus(id: string, isActive: boolean): Promise<CustomFieldDto> {
    const field = await this.getField(id);
    if (field.origin === 'SYSTEM') {
      throw new ForbiddenException({
        message: 'System fields cannot be disabled.',
        code: FIELD_ERROR_CODES.SYSTEM_READONLY,
      });
    }
    if (isActive && field.disabledReason === 'REMOVED_IN_SALESHANDY') {
      throw new ConflictException({
        message:
          'This field no longer exists in Saleshandy and cannot be enabled.',
        code: FIELD_ERROR_CODES.REMOVED_IN_SALESHANDY,
      });
    }
    if (field.isActive === isActive) return toFieldDto(field);
    const updated = await this.prisma.customField.update({
      where: { id: field.id },
      data: { isActive, disabledReason: isActive ? null : 'MANUAL' },
    });
    return toFieldDto(updated);
  }

  private async getField(id: string): Promise<CustomField> {
    const field = await this.prisma.customField.findFirst({
      where: { OR: [{ id }, { saleshandyFieldId: id }] },
    });
    if (!field) throw new NotFoundException('Field not found.');
    return field;
  }

  private assertWritable(field: CustomField) {
    if (field.origin === 'SYSTEM') {
      throw new ForbiddenException({
        message: 'System fields cannot be edited.',
        code: FIELD_ERROR_CODES.SYSTEM_READONLY,
      });
    }
    if (field.disabledReason === 'REMOVED_IN_SALESHANDY') {
      throw new ConflictException({
        message: 'This field no longer exists in Saleshandy.',
        code: FIELD_ERROR_CODES.REMOVED_IN_SALESHANDY,
      });
    }
    if (!field.saleshandyFieldId) {
      throw new ConflictException({
        message: 'This field is not linked to Saleshandy. Sync first.',
        code: FIELD_ERROR_CODES.NOT_LINKED,
      });
    }
  }

  /** No duplicates: a system field label is reserved; custom labels are unique. */
  private async assertLabelAvailable(label: string, exceptId?: string) {
    const clash = await this.prisma.customField.findFirst({
      where: {
        label: { equals: label, mode: 'insensitive' },
        // SQL `<>` drops NULLs, so match "no reason" explicitly.
        OR: [{ disabledReason: null }, { disabledReason: 'MANUAL' }],
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { origin: true },
    });
    if (!clash) return;
    throw clash.origin === 'SYSTEM'
      ? new BadRequestException({
          message: `"${label}" is a system field name.`,
          code: FIELD_ERROR_CODES.SYSTEM_NAME_CONFLICT,
        })
      : new ConflictException({
          message: `A field named "${label}" already exists.`,
          code: FIELD_ERROR_CODES.LABEL_CONFLICT,
        });
  }
}
