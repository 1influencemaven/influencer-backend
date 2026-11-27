jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ImportProspectsCsvDto } from './dto/prospects.dto';
import {
  normalizeFieldValue,
  ProspectsCsvService,
} from './prospects-csv.service';
import { ProspectsIngestionService } from './prospects-ingestion.service';
import {
  isValidEmail,
  mergeAttributes,
  mergeTags,
  normalizeEmail,
  splitName,
} from './prospects.mapper';

type Row = Record<string, unknown>;

describe('prospects.mapper', () => {
  it('normalizes and validates emails', () => {
    expect(normalizeEmail('  Ana@Brand.COM ')).toBe('ana@brand.com');
    expect(isValidEmail('partnerships@brand.co')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a b@brand.com')).toBe(false);
  });

  it('splits real names only', () => {
    expect(splitName('Ana María Pérez')).toEqual({
      firstName: 'Ana',
      lastName: 'María Pérez',
    });
    expect(splitName('Ana')).toEqual({ firstName: 'Ana', lastName: null });
    expect(splitName('  ')).toEqual({ firstName: null, lastName: null });
  });

  it('merges like Saleshandy conflictAction', () => {
    const existing = {
      firstName: 'Ana',
      company: null,
      contactKind: 'PERSON',
      commercialRelevance: 'UNKNOWN',
    };
    const incoming = {
      firstName: 'Anna',
      company: 'Brand',
      jobTitle: '',
      commercialRelevance: 'HIGH' as const,
    };
    expect(mergeAttributes(existing, incoming, 'addMissingFields')).toEqual({
      company: 'Brand',
      commercialRelevance: 'HIGH',
    });
    expect(mergeAttributes(existing, incoming, 'overwrite')).toEqual({
      firstName: 'Anna',
      company: 'Brand',
      commercialRelevance: 'HIGH',
    });
    expect(mergeAttributes(existing, incoming, 'noUpdate')).toEqual({});
  });

  it('upgrades a mailbox to a person but never the reverse', () => {
    expect(
      mergeAttributes(
        { contactKind: 'MAILBOX' },
        { contactKind: 'PERSON' },
        'addMissingFields',
      ),
    ).toMatchObject({
      contactKind: 'PERSON',
      isGeneric: false,
    });
    expect(
      mergeAttributes(
        { contactKind: 'PERSON' },
        { contactKind: 'MAILBOX' },
        'overwrite',
      ),
    ).toEqual({});
  });

  it('merges tags case-insensitively', () => {
    expect(mergeTags(['Agencia'], ['agencia', 'VIP', ' '])).toEqual([
      'Agencia',
      'VIP',
    ]);
  });
});

function makePrisma(existing: Row | null = null) {
  const tx = {
    prospect: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn(({ data }: { data: Row }) =>
        Promise.resolve({ id: 'p-new', ...data }),
      ),
      update: jest.fn(({ data }: { data: Row }) =>
        Promise.resolve({ ...existing, ...data }),
      ),
    },
    lead: { update: jest.fn().mockResolvedValue({}) },
    prospectFieldValue: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) =>
      Promise.resolve(fn(tx)),
    ),
    lead: { ...tx.lead, findUnique: jest.fn(), findMany: jest.fn() },
    brandBusinessContact: { findUnique: jest.fn() },
    agencyContact: { findUnique: jest.fn() },
    prospect: {
      ...tx.prospect,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn(),
    },
    customField: { findMany: jest.fn().mockResolvedValue([]) },
    prospectSyncJob: {
      create: jest.fn().mockResolvedValue({ id: 'job1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return { prisma, tx };
}

const brand = {
  id: 'b1',
  influencerId: 'i1',
  name: 'Pixi',
  website: 'https://www.pixibeauty.com',
  domain: '',
};

describe('ProspectsIngestionService', () => {
  it('approving a generic brand inbox never invents a name (RF-01)', async () => {
    const { prisma, tx } = makePrisma();
    prisma.brandBusinessContact.findUnique.mockResolvedValue({
      id: 'c1',
      email: 'Partnerships@pixibeauty.com',
      label: 'Partnerships',
      isGeneric: true,
      commercialRelevance: 'HIGH',
      brandCandidate: brand,
    });
    const service = new ProspectsIngestionService(prisma as never);
    const [result] = await service.approve(
      [{ type: 'BRAND_CONTACT', id: 'c1' }],
      'u1',
    );
    expect(result).toMatchObject({ outcome: 'created', prospectId: 'p-new' });
    const data = tx.prospect.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      influencerId: 'i1',
      emailNormalized: 'partnerships@pixibeauty.com',
      source: 'BRAND_CONTACT',
      contactKind: 'MAILBOX',
      isGeneric: true,
      mailboxLabel: 'Partnerships',
      company: 'Pixi',
      companyDomain: 'pixibeauty.com',
      brandBusinessContactId: 'c1',
      createdById: 'u1',
    });
    expect(data.firstName).toBeUndefined();
  });

  it('approving a person lead marks it APPROVED and maps name/title/LinkedIn', async () => {
    const { prisma, tx } = makePrisma();
    prisma.lead.findUnique.mockResolvedValue({
      id: 'l1',
      influencerId: 'i1',
      brandCandidateId: 'b1',
      contactName: 'Laura Gómez',
      title: 'Influencer Marketing Manager',
      email: null,
      emailConfidence: 'VALID',
      isGeneric: false,
      profileUrl: 'https://linkedin.com/in/laura',
      brandCandidate: brand,
      contactChannels: [{ type: 'EMAIL', value: 'laura@pixibeauty.com' }],
    });
    const service = new ProspectsIngestionService(prisma as never);
    await service.approve([{ type: 'LEAD', id: 'l1' }]);
    expect(tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { status: 'APPROVED' },
    });
    expect(tx.prospect.create.mock.calls[0][0].data).toMatchObject({
      email: 'laura@pixibeauty.com',
      firstName: 'Laura',
      lastName: 'Gómez',
      jobTitle: 'Influencer Marketing Manager',
      contactKind: 'PERSON',
      linkedInUrl: 'https://linkedin.com/in/laura',
      leadId: 'l1',
    });
  });

  it('skips leads without a valid email and agency contacts without a linked talent', async () => {
    const { prisma } = makePrisma();
    prisma.lead.findUnique.mockResolvedValue({
      id: 'l2',
      influencerId: 'i1',
      brandCandidateId: 'b1',
      contactName: 'X',
      email: 'nope',
      emailConfidence: 'UNKNOWN',
      isGeneric: false,
      profileUrl: null,
      brandCandidate: brand,
      contactChannels: [],
    });
    prisma.agencyContact.findUnique.mockResolvedValue({
      id: 'a1',
      email: 'hi@agency.com',
      contactKind: 'MAILBOX',
      isGeneric: true,
      label: null,
      commercialRelevance: 'UNKNOWN',
      agency: {
        id: 'ag',
        name: 'Agency',
        website: null,
        domain: 'agency.com',
        country: null,
        influencerAgencies: [],
      },
    });
    const service = new ProspectsIngestionService(prisma as never);
    const results = await service.approve([
      { type: 'LEAD', id: 'l2' },
      { type: 'AGENCY_CONTACT', id: 'a1' },
      { type: 'AGENCY_CONTACT', id: 'a1', influencerId: 'i1' },
    ]);
    expect(results.map((r) => r.reason)).toEqual([
      'NO_VALID_EMAIL',
      'INFLUENCER_REQUIRED',
      'AGENCY_NOT_LINKED',
    ]);
  });

  it('re-approving merges into the existing prospect and reactivates it', async () => {
    const existing = {
      id: 'p1',
      influencerId: 'i1',
      email: 'pr@pixi.com',
      firstName: null,
      company: 'Pixi',
      companyDomain: 'pixi.com',
      contactKind: 'MAILBOX',
      commercialRelevance: 'UNKNOWN',
      tags: [],
      status: 'ARCHIVED',
      brandBusinessContactId: null,
      leadId: null,
      brandCandidateId: 'b1',
      agencyId: null,
      agencyContactId: null,
    };
    const { prisma, tx } = makePrisma(existing);
    const service = new ProspectsIngestionService(prisma as never);
    const res = await service.upsert(tx as never, {
      influencerId: 'i1',
      email: 'PR@pixi.com',
      source: 'BRAND_CONTACT',
      links: { brandBusinessContactId: 'c9' },
      attributes: { company: 'Other', commercialRelevance: 'HIGH' },
    });
    expect(res.outcome).toBe('updated');
    expect(tx.prospect.update.mock.calls[0][0].data).toEqual({
      commercialRelevance: 'HIGH',
      brandBusinessContactId: 'c9',
      status: 'ACTIVE',
    });
  });

  it('lead hook: APPROVED creates, DISCARDED archives, errors never propagate', async () => {
    const { prisma } = makePrisma();
    prisma.lead.findUnique.mockRejectedValueOnce(new Error('db down'));
    const service = new ProspectsIngestionService(prisma as never);
    await expect(
      service.onLeadStatusChanged('l1', 'APPROVED'),
    ).resolves.toBeUndefined();
    await service.onLeadStatusChanged('l1', 'DISCARDED');
    expect(prisma.prospect.updateMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', leadId: 'l1' },
      data: { status: 'ARCHIVED' },
    });
  });
});

describe('ProspectsCsvService', () => {
  const fields = [
    {
      id: 'f-first',
      key: 'firstName',
      label: 'First Name',
      fieldType: 'TEXT',
      metadata: null,
      isActive: true,
    },
    {
      id: 'f-deal',
      key: 'dealValue',
      label: 'Deal Value',
      fieldType: 'CURRENCY',
      metadata: null,
      isActive: true,
    },
    {
      id: 'f-stage',
      key: 'stage',
      label: 'Stage',
      fieldType: 'DROPDOWN',
      metadata: { options: ['Open', 'Won'] },
      isActive: true,
    },
  ];

  it('normalizes typed values', () => {
    expect(
      normalizeFieldValue(
        { fieldType: 'CURRENCY', metadata: null } as never,
        '$1,200',
      ),
    ).toEqual({ ok: true, value: '1200' });
    expect(
      normalizeFieldValue(
        { fieldType: 'DATE', metadata: null } as never,
        '2026-03-05',
      ),
    ).toEqual({ ok: true, value: '2026-03-05' });
    expect(
      normalizeFieldValue(
        { fieldType: 'DATE', metadata: null } as never,
        'soon',
      ),
    ).toEqual({ ok: false });
    expect(normalizeFieldValue(fields[2] as never, 'won')).toEqual({
      ok: true,
      value: 'Won',
    });
    expect(normalizeFieldValue(fields[2] as never, 'Lost')).toEqual({
      ok: false,
    });
  });

  it('imports rows: validates emails, dedupes the file, maps columns and custom fields', async () => {
    const { prisma, tx } = makePrisma();
    prisma.customField.findMany.mockResolvedValue(fields);
    const service = new ProspectsCsvService(
      prisma as never,
      new ProspectsIngestionService(prisma as never),
    );
    const result = await service.import({
      influencerId: 'i1',
      conflictAction: 'addMissingFields',
      rows: [
        {
          email: 'ana@brand.com',
          firstName: 'Ana',
          company: 'Brand',
          dealValue: '$500',
          stage: 'open',
        },
        { email: 'ANA@brand.com', firstName: 'Dup' },
        { email: 'bad-email', firstName: 'X' },
        { email: 'info@brand.com', stage: 'Lost' },
        { email: 'hello@brand.com', company: 'Brand' },
      ],
    });
    expect(result).toMatchObject({
      total: 5,
      created: 2,
      skipped: 1,
      failed: 2,
    });
    expect(result.errors.map((e) => e.reason)).toEqual([
      'DUPLICATE_IN_FILE',
      'INVALID_EMAIL',
      'INVALID_VALUE:Stage',
    ]);
    const created = tx.prospect.create.mock.calls.map((c) => c[0].data);
    expect(created[0]).toMatchObject({
      email: 'ana@brand.com',
      firstName: 'Ana',
      company: 'Brand',
      contactKind: 'PERSON',
      source: 'CSV',
    });
    expect(created[1]).toMatchObject({
      email: 'hello@brand.com',
      contactKind: 'MAILBOX',
      isGeneric: true,
    });
    expect(
      (
        tx.prospectFieldValue.upsert.mock.calls as unknown as Array<
          [{ create: Row }]
        >
      ).map(([arg]) => arg.create),
    ).toEqual([
      { prospectId: 'p-new', customFieldId: 'f-deal', value: '500' },
      { prospectId: 'p-new', customFieldId: 'f-stage', value: 'Open' },
    ]);
    const jobUpdate = (
      prisma.prospectSyncJob.update.mock.calls as unknown as Array<
        [{ data: Row }]
      >
    )[0][0];
    expect(jobUpdate.data).toMatchObject({
      status: 'COMPLETED',
      createdCount: 2,
      failedCount: 2,
    });
  });

  it('rejects files without an email mapping or with unknown fields', async () => {
    const { prisma } = makePrisma();
    prisma.customField.findMany.mockResolvedValue(fields);
    const service = new ProspectsCsvService(
      prisma as never,
      new ProspectsIngestionService(prisma as never),
    );
    await expect(
      service.import({
        influencerId: 'i1',
        conflictAction: 'overwrite',
        rows: [{ firstName: 'Ana' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.import({
        influencerId: 'i1',
        conflictAction: 'overwrite',
        rows: [{ email: 'a@b.com', ghost: 'x' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ImportProspectsCsvDto', () => {
  it('keeps row objects intact under implicit conversion (ValidationPipe settings)', () => {
    const dto = plainToInstance(
      ImportProspectsCsvDto,
      {
        influencerId: '2c058de3-1fa0-49d8-8409-5216e09a2704',
        conflictAction: 'overwrite',
        rows: [{ email: 'a@b.com', firstName: 'Ana' }],
      },
      { enableImplicitConversion: true },
    );
    expect(dto.rows).toEqual([{ email: 'a@b.com', firstName: 'Ana' }]);
    expect(
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
  });
});
