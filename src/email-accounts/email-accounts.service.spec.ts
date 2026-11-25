jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { BadRequestException } from '@nestjs/common';

import { mapEmailAccount } from './email-accounts.mapper';
import { EmailAccountsService } from './email-accounts.service';

const rawAccount = (over: Record<string, unknown> = {}) => ({
  id: 'acc1',
  fromName: 'Ana Pérez',
  fromEmail: 'ana@brand.com',
  type: 3,
  status: 1,
  isDefault: true,
  healthScore: 92,
  createdAt: '2026-11-01T00:00:00.000Z',
  emailServiceProvider: 'zoho',
  user: { firstName: 'Luis', lastName: 'G' },
  client: { id: 'c1', firstName: 'Brand', lastName: 'Co' },
  sequences: [{ id: 's1', title: 'Q1 Outreach', active: true }],
  settings: [
    { code: 'daily-sending-limit', value: '40' },
    { code: 'available-quota', value: '12' },
    { code: 'min-interval', value: '60' },
    { code: 'max-interval', value: '180' },
    { code: 'ramp-up-status', value: '1' },
    { code: 'signature', value: '<p>Ana</p>' },
  ],
  ...over,
});

describe('mapEmailAccount', () => {
  it('maps status, settings, sequences and client', () => {
    expect(mapEmailAccount(rawAccount())).toMatchObject({
      id: 'acc1',
      senderFirstName: 'Ana',
      status: 'CONNECTED',
      type: 'SMTP_IMAP',
      provider: 'zoho',
      healthScore: 92,
      addedBy: 'Luis G',
      client: { id: 'c1', name: 'Brand Co' },
      sequences: [{ id: 's1', title: 'Q1 Outreach', active: true }],
      settings: {
        dailySendingLimit: 40,
        availableQuota: 12,
        minIntervalSeconds: 60,
        maxIntervalSeconds: 180,
        rampUpEnabled: true,
        signatureHtml: '<p>Ana</p>',
        bcc: null,
      },
    });
    expect(mapEmailAccount(rawAccount({ status: 0 }))?.status).toBe('DISCONNECTED');
    expect(mapEmailAccount(rawAccount({ status: 2 }))?.status).toBe('PAUSED');
    expect(mapEmailAccount({ id: 'x' })).toBeNull();
  });
});

function setup() {
  const request = jest.fn();
  const saleshandy = { request } as never;
  const prisma = {
    emailAccountJob: {
      create: jest.fn(async ({ data }) => ({ id: 'job1', ...data })),
      findFirst: jest.fn(),
      update: jest.fn(async ({ data }) => ({ id: 'job1', ...data })),
      findMany: jest.fn(),
    },
  };
  const service = new EmailAccountsService(saleshandy, prisma as never);
  return { service, request, prisma };
}

const listPayload = (emails: unknown[]) => ({
  payload: {
    emails,
    meta: { totalItems: emails.length, currentPage: 1, itemsPerPage: 25, totalPages: 1 },
    connectedEmailsCount: 1,
    disconnectedEmailsCount: 0,
    pausedEmailsCount: 0,
  },
});

const account = {
  provider: 'zoho' as const,
  fromFirstName: 'Ana',
  fromLastName: 'Pérez',
  smtp: { emailAddress: 'Ana@brand.com', userName: 'ana', password: 'p1', host: 'smtp.zoho.com', port: 465, encryption: 'ssl' as const },
  imap: { emailAddress: 'ana@brand.com', userName: 'ana', password: 'p2', host: 'imap.zoho.com', port: 993, encryption: 'ssl' as const },
};

describe('EmailAccountsService', () => {
  it('list translates filters/sort to Saleshandy and normalizes the page', async () => {
    const { service, request } = setup();
    request.mockResolvedValue(listPayload([rawAccount()]));
    const page = await service.list({
      page: 2,
      limit: 10,
      search: ' ana ',
      status: 'DISCONNECTED',
      providers: ['zoho'],
      sequenceIds: ['s1'],
      sortBy: 'healthScore',
      sortOrder: 'asc',
    });
    expect(request).toHaveBeenCalledWith('POST', '/email-accounts', {
      body: {
        page: 2,
        pageSize: 10,
        search: 'ana',
        status: 0,
        emailServiceProvider: ['zoho'],
        sequenceIds: ['s1'],
        sortByKey: 'health-score',
        sort: 'ASC',
      },
    });
    expect(page.data).toHaveLength(1);
    expect(page.meta).toEqual({ page: 1, limit: 25, total: 1, totalPages: 1 });
    expect(page.counts).toEqual({ connected: 1, disconnected: 0, paused: 0 });
  });

  it('connectSingle maps the shape, uppercases encryption and reports verification', async () => {
    const { service, request } = setup();
    request.mockResolvedValue({
      payload: { status: 0, smtpConnection: { error: 'Auth failed' }, imapConnection: { status: true } },
    });
    const result = await service.connectSingle(account);
    const body = request.mock.calls[0][2].body;
    expect(body).toMatchObject({
      emailServiceProvider: 'zoho',
      fromName: 'Ana Pérez',
      payload: { smtp: { encryption: 'SSL', port: 465 }, imap: { encryption: 'SSL' } },
    });
    expect(body.payload.imap.userName).toBeUndefined();
    expect(result).toMatchObject({
      saved: true,
      verified: false,
      smtp: { ok: false, error: 'Auth failed' },
      imap: { ok: true },
    });
    await expect(
      service.connectSingle({ ...account, smtp: { ...account.smtp, encryption: 'none' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('connectBulk sends flat accounts and stores a job without passwords', async () => {
    const { service, request, prisma } = setup();
    request.mockResolvedValue({ payload: { requestId: '129a184' } });
    const job = await service.connectBulk([account], 'user-1');
    expect(request.mock.calls[0][2].body[0]).toMatchObject({
      smtpPassword: 'p1',
      imapUserName: 'ana',
      smtpEncryption: 'ssl',
    });
    const stored = prisma.emailAccountJob.create.mock.calls[0][0].data;
    expect(stored).toEqual({
      requestId: '129a184',
      type: 'CONNECT',
      accountCount: 1,
      targets: ['ana@brand.com'],
      initiatedById: 'user-1',
    });
    expect(JSON.stringify(stored)).not.toContain('p1');
    expect(job.requestId).toBe('129a184');
  });

  it('getJob refreshes a processing job and stores the CSV report when completed', async () => {
    const { service, request, prisma } = setup();
    prisma.emailAccountJob.findFirst.mockResolvedValue({
      id: 'job1',
      requestId: 'r1',
      status: 'PROCESSING',
      createdAt: new Date(),
      lastCheckedAt: null,
    });
    request.mockResolvedValue({ payload: { isCompleted: true, reportURL: 'https://x/report.csv' } });
    const job = await service.getJob('job1');
    expect(request).toHaveBeenCalledWith('GET', '/email-accounts/connect/status/r1', { timeoutMs: 15000 });
    expect(job).toMatchObject({ status: 'COMPLETED', reportUrl: 'https://x/report.csv' });
  });

  it('getJob does not call Saleshandy again within the refresh window or for finished jobs', async () => {
    const { service, request, prisma } = setup();
    prisma.emailAccountJob.findFirst.mockResolvedValueOnce({
      id: 'job1', requestId: 'r1', status: 'PROCESSING', createdAt: new Date(), lastCheckedAt: new Date(),
    });
    await service.getJob('job1');
    prisma.emailAccountJob.findFirst.mockResolvedValueOnce({ id: 'job1', status: 'COMPLETED' });
    await service.getJob('job1');
    expect(request).not.toHaveBeenCalled();
  });

  it('bulkUpdate keeps each account\'s first name when the user does not change it', async () => {
    const { service, request } = setup();
    request
      .mockResolvedValueOnce(
        listPayload([
          rawAccount({ id: 'a1', fromName: 'Ana Pérez' }),
          rawAccount({ id: 'a2', fromName: 'Ana Ruiz' }),
          rawAccount({ id: 'b1', fromName: 'Bea' }),
        ]),
      )
      .mockResolvedValue({ payload: 'ok' });
    const result = await service.bulkUpdate({ emailAccountIds: ['a1', 'a2', 'b1'], dailyQuota: 50 });
    const updates = request.mock.calls.filter(([, path]) => path === '/email-accounts/bulk-update');
    expect(updates.map((c) => c[2].body)).toEqual([
      { emailAccountIds: ['a1', 'a2'], senderFirstName: 'Ana', dailyQuota: 50 },
      { emailAccountIds: ['b1'], senderFirstName: 'Bea', dailyQuota: 50 },
    ]);
    expect(result).toEqual({ updated: 3, requests: 2 });
  });

  it('bulkUpdate validates intervals and empty changes', async () => {
    const { service } = setup();
    await expect(
      service.bulkUpdate({ emailAccountIds: ['a1'], sendingIntervalMin: 200, sendingIntervalMax: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.bulkUpdate({ emailAccountIds: ['a1'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('bulkUpdate with an explicit first name sends one request', async () => {
    const { service, request } = setup();
    request.mockResolvedValue({ payload: 'ok' });
    await service.bulkUpdate({ emailAccountIds: ['a1', 'b1'], senderFirstName: 'Team', bcc: '' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][2].body).toEqual({
      emailAccountIds: ['a1', 'b1'],
      senderFirstName: 'Team',
      bcc: '',
    });
  });
});
