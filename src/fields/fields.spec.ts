jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

import {
  SALESHANDY_ERROR_CODES,
  SaleshandyApiException,
  toSaleshandyException,
} from '../integrations/saleshandy/saleshandy.errors';
import { FieldsSyncService } from './fields-sync.service';
import {
  buildFieldMetadata,
  parseRemoteFields,
  slugifyKey,
  toFieldDto,
  uniqueKey,
} from './fields.mapper';
import { FieldsService } from './fields.service';

/** Shape observed live on 2026-11-25. */
const REMOTE = [
  {
    id: 'r-first',
    label: 'First Name',
    fieldType: 'text',
    mappingDefaultField: 'firstName',
    tags: [],
  },
  {
    id: 'r-email',
    label: 'Email',
    fieldType: 'text',
    mappingDefaultField: 'email',
    tags: [],
  },
  {
    id: 'r-head',
    label: 'Profile Headline',
    fieldType: 'long-text',
    mappingDefaultField: '',
    tags: [],
  },
  {
    id: 'r-deal',
    label: 'Deal Stage',
    fieldType: 'dropdown',
    tags: [{ id: 't1', name: 'CRM' }],
  },
];

type Row = Record<string, any>;

const row = (over: Row = {}): Row => ({
  id: 'f1',
  key: 'dealStage',
  label: 'Deal Stage',
  fieldType: 'DROPDOWN',
  origin: 'CUSTOM',
  fallbackText: 'n/a',
  saleshandyFieldId: 'r-deal',
  systemMapping: null,
  metadata: { options: ['A', 'B'] },
  tags: ['CRM'],
  isActive: true,
  disabledReason: null,
  lastSyncedAt: null,
  createdAt: new Date('2026-11-01'),
  updatedAt: new Date('2026-11-01'),
  ...over,
});

describe('fields.mapper', () => {
  it('derives origin from mappingDefaultField presence and normalizes tags', () => {
    const parsed = parseRemoteFields(REMOTE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fields.map((f) => [f.id, f.origin, f.systemMapping])).toEqual(
      [
        ['r-first', 'SYSTEM', 'firstName'],
        ['r-email', 'SYSTEM', 'email'],
        ['r-head', 'SYSTEM', null],
        ['r-deal', 'CUSTOM', null],
      ],
    );
    expect(parsed.fields[3].tags).toEqual(['CRM']);
  });

  it('rejects malformed or partial payloads and skips unknown types', () => {
    expect(parseRemoteFields({ fields: [] })).toEqual({
      ok: false,
      reason: 'payload_not_array',
    });
    expect(parseRemoteFields([{ id: 'x' }]).ok).toBe(false);
    expect(parseRemoteFields([REMOTE[0], REMOTE[0]]).ok).toBe(false);
    const parsed = parseRemoteFields([
      ...REMOTE,
      { id: 'r-new', label: 'Geo', fieldType: 'location' },
    ]);
    expect(parsed).toMatchObject({ ok: true, skippedIds: ['r-new'] });
  });

  it('validates per-type metadata', () => {
    expect(buildFieldMetadata('text', { options: ['x'] })).toEqual({
      metadata: null,
    });
    expect(
      buildFieldMetadata('dropdown', { options: [' Free ', 'free', 'Pro'] }),
    ).toEqual({
      metadata: { options: ['Free', 'Pro'] },
    });
    expect(buildFieldMetadata('dropdown', { options: [] })).toHaveProperty(
      'error',
    );
    expect(
      buildFieldMetadata('dropdown', {
        options: Array.from({ length: 51 }, (_, i) => `o${i}`),
      }),
    ).toHaveProperty('error');
    expect(buildFieldMetadata('currency', { currencyCode: 'mxn' })).toEqual({
      metadata: { currencyCode: 'MXN' },
    });
    expect(
      buildFieldMetadata('currency', { currencyCode: 'COP' }),
    ).toHaveProperty('error');
  });

  it('builds stable unique keys', () => {
    expect(slugifyKey('Company’s Latest Funding Date')).toBe(
      'companysLatestFundingDate',
    );
    expect(slugifyKey('Año de fundación')).toBe('anoDeFundacion');
    expect(slugifyKey('2024 Budget')).toBe('field2024Budget');
    const taken = new Set(['dealstage']);
    expect(uniqueKey('dealStage', taken)).toBe('dealStage2');
    expect(uniqueKey('dealStage', taken)).toBe('dealStage3');
  });

  it('exposes editability in the DTO', () => {
    expect(toFieldDto(row() as never)).toMatchObject({
      fieldType: 'dropdown',
      editable: true,
    });
    expect(toFieldDto(row({ origin: 'SYSTEM' }) as never).editable).toBe(false);
    expect(
      toFieldDto(row({ disabledReason: 'REMOVED_IN_SALESHANDY' }) as never)
        .editable,
    ).toBe(false);
  });

  it('maps Saleshandy 400 "Field not found" to 404', () => {
    const error = toSaleshandyException(400, '1001: Field not found<br><br>');
    expect(error.code).toBe(SALESHANDY_ERROR_CODES.NOT_FOUND);
    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(
      toSaleshandyException(
        400,
        '1001: Default fields cannot be added as custom fields',
      ).code,
    ).toBe(SALESHANDY_ERROR_CODES.VALIDATION);
  });
});

function setupPrisma(local: Row[] = []) {
  const tx = {
    $executeRaw: jest.fn(),
    customField: {
      findMany: jest.fn(async () => local),
      create: jest.fn(async ({ data }) => data),
      update: jest.fn(async ({ data }) => ({ ...row(), ...data })),
      updateMany: jest.fn(),
    },
    customFieldSyncRun: { create: jest.fn(async () => ({ id: 'run1' })) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    customField: {
      ...tx.customField,
      count: jest.fn(async () => local.length),
      findFirst: jest.fn(),
      upsert: jest.fn(async ({ create }) => ({
        ...row(),
        ...create,
        id: 'new',
      })),
    },
    customFieldSyncRun: {
      create: jest.fn(),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
  };
  return { tx, prisma };
}

describe('FieldsSyncService', () => {
  const make = (local: Row[], payload: unknown) => {
    const request = jest.fn(async () => ({ payload }));
    const saleshandy = { request, isConfigured: () => true } as never;
    const { tx, prisma } = setupPrisma(local);
    return {
      service: new FieldsSyncService(saleshandy, prisma as never),
      tx,
      prisma,
      request,
    };
  };

  it('imports a fresh catalog in one call with stable keys', async () => {
    const { service, tx, request } = make([], REMOTE);
    const summary = await service.sync('BOOTSTRAP');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('GET', '/fields', {
      query: { systemFields: 'true' },
      timeoutMs: 20000,
    });
    expect(tx.customField.create.mock.calls.map((c) => c[0].data.key)).toEqual([
      'firstName',
      'email',
      'profileHeadline',
      'dealStage',
    ]);
    expect(summary).toMatchObject({ created: 4, updated: 0, deactivated: 0 });
  });

  it('updates remote attributes but never fallbackText/metadata', async () => {
    const { service, tx } = make(
      [row()],
      [
        {
          ...REMOTE[3],
          label: 'Pipeline Stage',
          tags: [{ id: 't2', name: 'Sales' }],
        },
      ],
    );
    const summary = await service.sync('MANUAL');
    const data = tx.customField.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ label: 'Pipeline Stage', tags: ['Sales'] });
    expect(data).not.toHaveProperty('fallbackText');
    expect(data).not.toHaveProperty('metadata');
    expect(summary).toMatchObject({ updated: 1, unchanged: 0 });
  });

  it('is idempotent: a second identical sync changes nothing', async () => {
    const { service, tx } = make([row()], [REMOTE[3]]);
    const summary = await service.sync('MANUAL');
    expect(Object.keys(tx.customField.update.mock.calls[0][0].data)).toEqual([
      'lastSyncedAt',
    ]);
    expect(summary).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it('disables fields removed in Saleshandy and keeps admin-disabled ones disabled', async () => {
    const gone = row({ id: 'g', key: 'gone', saleshandyFieldId: 'r-gone' });
    const manual = row({ isActive: false, disabledReason: 'MANUAL' });
    const { service, tx } = make([gone, manual], [REMOTE[3]]);
    const summary = await service.sync('MANUAL');
    expect(tx.customField.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['g'] } },
      data: { isActive: false, disabledReason: 'REMOVED_IN_SALESHANDY' },
    });
    expect(tx.customField.update.mock.calls[0][0].data).not.toHaveProperty(
      'isActive',
    );
    expect(summary).toMatchObject({ deactivated: 1, reactivated: 0 });
  });

  it('reactivates a field that reappears in Saleshandy', async () => {
    const { service, tx } = make(
      [row({ isActive: false, disabledReason: 'REMOVED_IN_SALESHANDY' })],
      [REMOTE[3]],
    );
    const summary = await service.sync('MANUAL');
    expect(tx.customField.update.mock.calls[0][0].data).toMatchObject({
      isActive: true,
      disabledReason: null,
    });
    expect(summary.reactivated).toBe(1);
  });

  it('aborts without touching data on API errors, invalid or partial payloads', async () => {
    const systemRows = ['a', 'b', 'c', 'd', 'e'].map((k) =>
      row({ id: k, key: k, origin: 'SYSTEM', saleshandyFieldId: `r-${k}` }),
    );
    for (const payload of [{ nope: true }, [], [REMOTE[0]]]) {
      const { service, tx, prisma } = make(systemRows, payload);
      await expect(service.sync('MANUAL')).rejects.toBeInstanceOf(
        SaleshandyApiException,
      );
      expect(tx.customField.create).not.toHaveBeenCalled();
      expect(tx.customField.updateMany).not.toHaveBeenCalled();
      expect(prisma.customFieldSyncRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    }
    const { service, prisma } = make([], REMOTE);
    (service as any).saleshandy.request = jest.fn(async () => {
      throw toSaleshandyException(500, '5001: Internal server error');
    });
    await expect(service.sync('MANUAL')).rejects.toBeInstanceOf(
      SaleshandyApiException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('FieldsService', () => {
  const make = (local: Row[] = [row()]) => {
    const request = jest.fn(
      async (): Promise<{ payload: unknown }> => ({
        payload: { id: 'r-created' },
      }),
    );
    const saleshandy = { request } as never;
    const { prisma } = setupPrisma(local);
    const sync = { isAvailable: () => true, sync: jest.fn(async () => ({})) };
    const service = new FieldsService(
      saleshandy,
      prisma as never,
      sync as never,
    );
    return { service, request, prisma, sync };
  };

  it('lists active fields with counts, filters and tags', async () => {
    const { service, sync } = make([
      row(),
      row({
        id: 's',
        key: 'email',
        label: 'Email',
        fieldType: 'TEXT',
        origin: 'SYSTEM',
        tags: [],
      }),
      row({
        id: 'd',
        key: 'old',
        label: 'Old',
        isActive: false,
        disabledReason: 'MANUAL',
        tags: ['Legacy'],
      }),
    ]);
    const res = await service.list({ origin: 'all', status: 'active' });
    expect(sync.sync).not.toHaveBeenCalled();
    expect(res.data.map((f) => f.label)).toEqual(['Deal Stage', 'Email']);
    expect(res.counts).toEqual({ all: 2, custom: 1, system: 1, disabled: 1 });
    expect(res.availableTags).toEqual(['CRM', 'Legacy']);
    expect(
      (await service.list({ origin: 'system' })).data.map((f) => f.key),
    ).toEqual(['email']);
    expect(
      (await service.list({ fieldTypes: ['dropdown'] })).data,
    ).toHaveLength(1);
    expect(
      (await service.list({ search: 'crm' })).data.map((f) => f.key),
    ).toEqual(['dealStage']);
    expect(
      (await service.list({ status: 'disabled' })).data.map((f) => f.key),
    ).toEqual(['old']);
  });

  it('bootstraps an empty catalog once', async () => {
    const { service, sync } = make([]);
    await service.list({});
    expect(sync.sync).toHaveBeenCalledWith('BOOTSTRAP');
  });

  it('creates a dropdown field in Saleshandy and stores fallback/metadata locally', async () => {
    const { service, request, prisma } = make([]);
    prisma.customField.findFirst.mockResolvedValue(null);
    const dto = await service.create({
      label: ' Plan Tier ',
      fieldType: 'dropdown',
      fallbackText: 'Free',
      metadata: { options: ['Free', 'Pro', 'pro'] },
      tags: ['CRM', 'crm'],
    });
    expect(request).toHaveBeenCalledWith('POST', '/fields', {
      body: {
        label: 'Plan Tier',
        fieldType: 'dropdown',
        fallbackText: 'Free',
        metadata: { options: ['Free', 'Pro'] },
        tags: ['CRM'],
      },
    });
    const upsert = prisma.customField.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ saleshandyFieldId: 'r-created' });
    expect(upsert.create).toMatchObject({
      key: 'planTier',
      origin: 'CUSTOM',
      fallbackText: 'Free',
      metadata: { options: ['Free', 'Pro'] },
    });
    expect(dto.saleshandyFieldId).toBe('r-created');
  });

  it('rejects invalid metadata and duplicate / system labels before calling Saleshandy', async () => {
    const { service, request, prisma } = make([]);
    await expect(
      service.create({ label: 'Price', fieldType: 'currency' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.customField.findFirst.mockResolvedValueOnce({ origin: 'SYSTEM' });
    await expect(
      service.create({ label: 'email', fieldType: 'text' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.customField.findFirst.mockResolvedValueOnce({ origin: 'CUSTOM' });
    await expect(
      service.create({ label: 'Deal Stage', fieldType: 'text' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(request).not.toHaveBeenCalled();
  });

  it('update omits tags when not sent and replaces them when sent', async () => {
    const { service, request, prisma } = make();
    prisma.customField.findFirst
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null);
    await service.update('f1', { label: 'Pipeline Stage' });
    expect(request).toHaveBeenLastCalledWith('PATCH', '/fields/r-deal', {
      body: { label: 'Pipeline Stage' },
    });

    prisma.customField.findFirst.mockResolvedValueOnce(row());
    await service.update('f1', { tags: [] });
    expect(request).toHaveBeenLastCalledWith('PATCH', '/fields/r-deal', {
      body: { tags: [] },
    });
    expect(prisma.customField.update.mock.calls.at(-1)?.[0].data).toMatchObject(
      { tags: [] },
    );
  });

  it('blocks system fields, unchanged updates and disables fields gone from Saleshandy', async () => {
    const { service, request, prisma } = make();
    prisma.customField.findFirst.mockResolvedValueOnce(
      row({ origin: 'SYSTEM' }),
    );
    await expect(service.update('f1', { label: 'X' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    prisma.customField.findFirst.mockResolvedValueOnce(row());
    await expect(
      service.update('f1', { label: 'Deal Stage' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(request).not.toHaveBeenCalled();

    prisma.customField.findFirst.mockResolvedValueOnce(row());
    request.mockRejectedValueOnce(
      toSaleshandyException(400, '1001: Field not found'),
    );
    await expect(
      service.update('f1', { fallbackText: 'none' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customField.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { isActive: false, disabledReason: 'REMOVED_IN_SALESHANDY' },
    });
  });

  it('enables/disables custom fields locally only', async () => {
    const { service, request, prisma } = make();
    prisma.customField.findFirst.mockResolvedValueOnce(row());
    await service.setStatus('f1', false);
    expect(prisma.customField.update).toHaveBeenLastCalledWith({
      where: { id: 'f1' },
      data: { isActive: false, disabledReason: 'MANUAL' },
    });
    prisma.customField.findFirst.mockResolvedValueOnce(
      row({ origin: 'SYSTEM' }),
    );
    await expect(service.setStatus('f1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    prisma.customField.findFirst.mockResolvedValueOnce(
      row({ isActive: false, disabledReason: 'REMOVED_IN_SALESHANDY' }),
    );
    await expect(service.setStatus('f1', true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(request).not.toHaveBeenCalled();
  });
});
