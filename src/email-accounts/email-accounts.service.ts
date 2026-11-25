import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  EmailAccountJobStatus,
  EmailAccountJobType,
} from '../generated/prisma/enums';
import { SaleshandyHttpService } from '../integrations/saleshandy/saleshandy-http.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  EmailAccountConnectionDto,
  MailEncryption,
} from './dto/connect-email-account.dto';
import type { BulkUpdateEmailAccountsDto } from './dto/email-account-actions.dto';
import type {
  EmailAccountSortKey,
  QueryEmailAccountsDto,
} from './dto/query-email-accounts.dto';
import {
  emailAccountStatusToCode,
  mapEmailAccount,
  type EmailAccountDto,
} from './email-accounts.mapper';

const SORT_KEYS: Record<EmailAccountSortKey, string> = {
  createdAt: 'created-date',
  healthScore: 'health-score',
  remainingQuota: 'remaining-quota',
  client: 'clientFirstName',
};

/** Single connect verifies SMTP + IMAP synchronously: allow slow mail servers. */
const SINGLE_CONNECT_TIMEOUT_MS = 120_000;
/** Do not hit Saleshandy more than once per job in this window (polling bursts). */
const STATUS_REFRESH_MIN_MS = 4_000;
/** A job not completed after this long is reported as FAILED (stuck upstream). */
const JOB_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export type EmailAccountsPage = {
  data: EmailAccountDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  counts: { connected: number; disconnected: number; paused: number };
};

export type SmtpImapConnectResult = {
  /** Saleshandy saves the account even when verification fails. */
  saved: true;
  verified: boolean;
  status: 0 | 1;
  emailAccountId: string | null;
  smtp: { ok: boolean; error: string | null };
  imap: { ok: boolean; error: string | null };
  message: string | null;
};

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function connectionCheck(raw: unknown): { ok: boolean; error: string | null } {
  const record = asRecord(raw);
  const error =
    typeof record.error === 'string'
      ? record.error
      : record.error && typeof record.error === 'object'
        ? String((record.error as Json).message ?? JSON.stringify(record.error))
        : null;
  const ok =
    record.status === true ||
    record.status === 1 ||
    record.success === true ||
    record.isConnected === true ||
    (!error && Object.keys(record).length > 0 && record.status !== false);
  return { ok: ok && !error, error };
}

const upper = (encryption: MailEncryption): 'SSL' | 'TLS' => {
  if (encryption === 'none') {
    throw new BadRequestException(
      'Single connect requires SSL or TLS encryption for SMTP and IMAP.',
    );
  }
  return encryption.toUpperCase() as 'SSL' | 'TLS';
};

/**
 * Email Accounts module (HU-EA-001..006) on top of the Saleshandy Open API.
 * SMTP/IMAP passwords only transit in memory to Saleshandy: never persisted
 * nor logged.
 */
@Injectable()
export class EmailAccountsService {
  private readonly logger = new Logger(EmailAccountsService.name);

  constructor(
    private readonly saleshandy: SaleshandyHttpService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------- HU-EA-001
  async list(query: QueryEmailAccountsDto): Promise<EmailAccountsPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const { payload } = await this.saleshandy.request<Json>('POST', '/email-accounts', {
      body: {
        page,
        pageSize: limit,
        ...(query.search?.trim() ? { search: query.search.trim() } : {}),
        ...(query.status ? { status: emailAccountStatusToCode(query.status) } : {}),
        ...(query.providers?.length ? { emailServiceProvider: query.providers } : {}),
        ...(query.sequenceIds?.length ? { sequenceIds: query.sequenceIds } : {}),
        ...(query.clientIds?.length ? { clientIds: query.clientIds } : {}),
        sortByKey: SORT_KEYS[query.sortBy ?? 'createdAt'],
        sort: (query.sortOrder ?? 'desc').toUpperCase(),
      },
    });
    const body = asRecord(payload);
    const meta = asRecord(body.meta);
    const data = (Array.isArray(body.emails) ? body.emails : [])
      .map(mapEmailAccount)
      .filter((a): a is EmailAccountDto => a !== null);
    const total = num(meta.totalItems, data.length);
    return {
      data,
      meta: {
        page: num(meta.currentPage, page),
        limit: num(meta.itemsPerPage, limit),
        total,
        totalPages: num(meta.totalPages, Math.max(1, Math.ceil(total / limit))),
      },
      counts: {
        connected: num(body.connectedEmailsCount),
        disconnected: num(body.disconnectedEmailsCount),
        paused: num(body.pausedEmailsCount),
      },
    };
  }

  /** Filter / selector options: Saleshandy sequences and clients. */
  async options(): Promise<{
    sequences: Array<{ id: string; title: string; active: boolean }>;
    clients: Array<{ id: string; name: string }>;
  }> {
    const [sequences, clients] = await Promise.all([
      this.saleshandy.request<unknown>('GET', '/sequences', {
        query: { pageSize: 100, page: 1 },
      }),
      this.saleshandy
        .request<unknown>('GET', '/clients', { query: { pageSize: 100, page: 1 } })
        // Clients only exist on agency plans: never fail the options call for them.
        .catch(() => ({ payload: [] as unknown })),
    ]);
    const list = (value: unknown): Json[] =>
      (Array.isArray(value) ? value : Array.isArray(asRecord(value).data) ? (asRecord(value).data as unknown[]) : [])
        .map(asRecord);
    return {
      sequences: list(sequences.payload)
        .filter((s) => typeof s.id === 'string')
        .map((s) => ({
          id: String(s.id),
          title: typeof s.title === 'string' ? s.title : String(s.id),
          active: s.active === true,
        })),
      clients: list(clients.payload)
        .filter((c) => typeof c.id === 'string')
        .map((c) => ({
          id: String(c.id),
          name:
            [c.firstName, c.lastName].filter((v) => typeof v === 'string' && v).join(' ') ||
            (typeof c.companyName === 'string' ? c.companyName : String(c.id)),
        })),
    };
  }

  // ---------------------------------------------------------------- HU-EA-006
  async connectSingle(account: EmailAccountConnectionDto): Promise<SmtpImapConnectResult> {
    const fromName =
      account.fromName?.trim() || `${account.fromFirstName} ${account.fromLastName}`.trim();
    const { payload, message } = await this.saleshandy.request<unknown>(
      'POST',
      '/email-accounts/smtp-imap/connect',
      {
        timeoutMs: SINGLE_CONNECT_TIMEOUT_MS,
        body: {
          emailServiceProvider: account.provider,
          fromName,
          fromFirstName: account.fromFirstName,
          fromLastName: account.fromLastName,
          payload: {
            smtp: {
              emailAddress: account.smtp.emailAddress,
              userName: account.smtp.userName,
              password: account.smtp.password,
              host: account.smtp.host,
              port: account.smtp.port,
              encryption: upper(account.smtp.encryption),
            },
            imap: {
              emailAddress: account.imap.emailAddress,
              password: account.imap.password,
              host: account.imap.host,
              port: account.imap.port,
              encryption: upper(account.imap.encryption),
            },
          },
        },
      },
    );
    const body = asRecord(payload);
    const status: 0 | 1 = body.status === 1 ? 1 : 0;
    const smtp = connectionCheck(body.smtpConnection);
    const imap = connectionCheck(body.imapConnection);
    this.logger.log(
      JSON.stringify({
        event: 'email_account_connected',
        provider: account.provider,
        verified: status === 1,
      }),
    );
    return {
      saved: true,
      verified: status === 1,
      status,
      emailAccountId:
        typeof body.id === 'string'
          ? body.id
          : typeof body.emailAccountId === 'string'
            ? body.emailAccountId
            : null,
      smtp: status === 1 ? { ok: true, error: null } : smtp,
      imap: status === 1 ? { ok: true, error: null } : imap,
      message: message ?? null,
    };
  }

  // ---------------------------------------------------------------- HU-EA-002
  async connectBulk(accounts: EmailAccountConnectionDto[], userId: string | null) {
    const { payload } = await this.saleshandy.request<Json>('POST', '/email-accounts/connect', {
      body: accounts.map((a) => ({
        emailServiceProvider: a.provider,
        fromFirstName: a.fromFirstName,
        fromLastName: a.fromLastName,
        smtpEmailAddress: a.smtp.emailAddress,
        smtpUserName: a.smtp.userName,
        smtpPassword: a.smtp.password,
        smtpHost: a.smtp.host,
        smtpPort: a.smtp.port,
        smtpEncryption: a.smtp.encryption,
        imapEmailAddress: a.imap.emailAddress,
        imapUserName: a.imap.userName,
        imapPassword: a.imap.password,
        imapHost: a.imap.host,
        imapPort: a.imap.port,
        imapEncryption: a.imap.encryption,
      })),
    });
    return this.createJob(
      EmailAccountJobType.CONNECT,
      asRecord(payload).requestId,
      accounts.map((a) => a.smtp.emailAddress.toLowerCase()),
      userId,
    );
  }

  // ---------------------------------------------------------------- HU-EA-003
  async reconnect(emailAccountIds: string[], userId: string | null) {
    const { payload } = await this.saleshandy.request<Json>(
      'POST',
      '/email-accounts/reconnect',
      { body: { emailAccountIds } },
    );
    return this.createJob(
      EmailAccountJobType.RECONNECT,
      asRecord(payload).requestId,
      emailAccountIds,
      userId,
    );
  }

  private async createJob(
    type: EmailAccountJobType,
    requestId: unknown,
    targets: string[],
    userId: string | null,
  ) {
    if (typeof requestId !== 'string' && typeof requestId !== 'number') {
      throw new BadRequestException(
        'Saleshandy accepted the request but did not return a requestId.',
      );
    }
    const job = await this.prisma.emailAccountJob.create({
      data: {
        requestId: String(requestId),
        type,
        accountCount: targets.length,
        targets,
        initiatedById: userId,
      },
    });
    this.logger.log(
      JSON.stringify({ event: 'email_account_job_created', type, requestId: job.requestId, count: targets.length }),
    );
    return job;
  }

  // ---------------------------------------------------------------- HU-EA-004
  listJobs(limit = 20) {
    return this.prisma.emailAccountJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: { initiatedBy: { select: { id: true, name: true, email: true } } },
    });
  }

  /** Returns the job, refreshing it from Saleshandy while it is still processing. */
  async getJob(id: string) {
    const job = await this.prisma.emailAccountJob.findFirst({
      where: { OR: [{ id }, { requestId: id }] },
    });
    if (!job) throw new NotFoundException(`Email account job ${id} not found`);
    if (job.status !== EmailAccountJobStatus.PROCESSING) return job;

    const now = Date.now();
    if (job.lastCheckedAt && now - job.lastCheckedAt.getTime() < STATUS_REFRESH_MIN_MS) {
      return job;
    }
    if (now - job.createdAt.getTime() > JOB_STALE_AFTER_MS) {
      return this.prisma.emailAccountJob.update({
        where: { id: job.id },
        data: {
          status: EmailAccountJobStatus.FAILED,
          errorMessage: 'Saleshandy did not complete the process in time.',
          lastCheckedAt: new Date(),
        },
      });
    }

    const { payload } = await this.saleshandy.request<Json>(
      'GET',
      `/email-accounts/connect/status/${encodeURIComponent(job.requestId)}`,
      { timeoutMs: 15_000 },
    );
    const body = asRecord(payload);
    const completed = body.isCompleted === true;
    const reportUrl = typeof body.reportURL === 'string' && body.reportURL ? body.reportURL : null;
    return this.prisma.emailAccountJob.update({
      where: { id: job.id },
      data: {
        lastCheckedAt: new Date(),
        ...(completed
          ? { status: EmailAccountJobStatus.COMPLETED, completedAt: new Date(), reportUrl }
          : {}),
      },
    });
  }

  // ---------------------------------------------------------------- HU-EA-005
  /**
   * Partial bulk update. Saleshandy requires `senderFirstName` on every call:
   * when the user does not change it, accounts are grouped by their current
   * first name and one update is sent per group, so names are never overwritten.
   */
  async bulkUpdate(dto: BulkUpdateEmailAccountsDto): Promise<{ updated: number; requests: number }> {
    const {
      emailAccountIds,
      senderFirstName,
      ...fields
    } = dto;
    if (
      fields.sendingIntervalMin !== undefined &&
      fields.sendingIntervalMax !== undefined &&
      fields.sendingIntervalMin > fields.sendingIntervalMax
    ) {
      throw new BadRequestException('Minimum interval cannot exceed maximum interval.');
    }
    const changes = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    if (!senderFirstName && Object.keys(changes).length === 0) {
      throw new BadRequestException('Select at least one setting to update.');
    }

    const groups = new Map<string, string[]>();
    if (senderFirstName) {
      groups.set(senderFirstName, emailAccountIds);
    } else {
      const current = await this.currentFirstNames(emailAccountIds);
      for (const id of emailAccountIds) {
        const name = current.get(id);
        if (!name) {
          throw new BadRequestException(
            `Email account ${id} was not found in Saleshandy.`,
          );
        }
        groups.set(name, [...(groups.get(name) ?? []), id]);
      }
    }

    for (const [firstName, ids] of groups) {
      await this.saleshandy.request('POST', '/email-accounts/bulk-update', {
        body: { emailAccountIds: ids, senderFirstName: firstName, ...changes },
      });
    }
    this.logger.log(
      JSON.stringify({
        event: 'email_accounts_bulk_updated',
        accounts: emailAccountIds.length,
        requests: groups.size,
        fields: [...Object.keys(changes), ...(senderFirstName ? ['senderFirstName'] : [])],
      }),
    );
    return { updated: emailAccountIds.length, requests: groups.size };
  }

  private async currentFirstNames(ids: string[]): Promise<Map<string, string>> {
    const wanted = new Set(ids);
    const names = new Map<string, string>();
    for (let page = 1; page <= 10 && names.size < wanted.size; page += 1) {
      const result = await this.list({ page, limit: 100 });
      for (const account of result.data) {
        if (wanted.has(account.id) && account.senderFirstName) {
          names.set(account.id, account.senderFirstName);
        }
      }
      if (page >= result.meta.totalPages) break;
    }
    return names;
  }
}
