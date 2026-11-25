/**
 * Saleshandy email-account payloads → Influence Maven DTOs (HU-EA-001).
 * Saleshandy is the source of truth; nothing here is persisted.
 */

export const EMAIL_ACCOUNT_STATUSES = ['DISCONNECTED', 'CONNECTED', 'PAUSED'] as const;
export type EmailAccountStatus = (typeof EMAIL_ACCOUNT_STATUSES)[number];

/** Saleshandy numeric status: 0 inactive/disconnected, 1 active, 2 paused/in progress. */
export function emailAccountStatusFromCode(code: unknown): EmailAccountStatus {
  if (code === 1) return 'CONNECTED';
  if (code === 2) return 'PAUSED';
  return 'DISCONNECTED';
}

export function emailAccountStatusToCode(status: EmailAccountStatus): number {
  return EMAIL_ACCOUNT_STATUSES.indexOf(status);
}

export type EmailAccountType = 'GMAIL' | 'MICROSOFT' | 'SMTP_IMAP';

function accountType(code: unknown): EmailAccountType {
  if (code === 1) return 'GMAIL';
  if (code === 2) return 'MICROSOFT';
  return 'SMTP_IMAP';
}

export type EmailAccountSettings = {
  dailySendingLimit: number | null;
  availableQuota: number | null;
  maxSendingLimit: number | null;
  minIntervalSeconds: number | null;
  maxIntervalSeconds: number | null;
  rampUpEnabled: boolean | null;
  rampUpInitialSendingLimit: number | null;
  rampUpPercent: number | null;
  rampUpLimit: number | null;
  bcc: string | null;
  signatureHtml: string | null;
};

export type EmailAccountDto = {
  id: string;
  fromName: string;
  fromEmail: string;
  /** First word of fromName: Saleshandy's list does not return first/last separately. */
  senderFirstName: string;
  provider: string | null;
  type: EmailAccountType;
  status: EmailAccountStatus;
  isDefault: boolean;
  healthScore: number | null;
  createdAt: string | null;
  addedBy: string | null;
  client: { id: string; name: string } | null;
  sequences: Array<{ id: string; title: string; active: boolean }>;
  settings: EmailAccountSettings;
};

type Json = Record<string, unknown>;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const num = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const bool = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (value === '1' || value === 1 || value === 'true') return true;
  if (value === '0' || value === 0 || value === 'false') return false;
  return null;
};

function fullName(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Json;
  const name = [str(r.firstName), str(r.lastName)].filter(Boolean).join(' ');
  return name || str(r.companyName) || str(r.email);
}

function settingsFrom(raw: unknown): EmailAccountSettings {
  const byCode = new Map<string, unknown>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (item && typeof item === 'object') {
      const code = str((item as Json).code);
      if (code) byCode.set(code, (item as Json).value);
    }
  }
  return {
    dailySendingLimit: num(byCode.get('daily-sending-limit')),
    availableQuota: num(byCode.get('available-quota')),
    maxSendingLimit: num(byCode.get('max-sending-limit')),
    minIntervalSeconds: num(byCode.get('min-interval')),
    maxIntervalSeconds: num(byCode.get('max-interval')),
    rampUpEnabled: bool(byCode.get('ramp-up-status')),
    rampUpInitialSendingLimit: num(byCode.get('ramp-up-initial-sending-limit')),
    rampUpPercent: num(byCode.get('ramp-up-percent')),
    rampUpLimit: num(byCode.get('ramp-up-limit')),
    bcc: str(byCode.get('bcc')),
    signatureHtml: str(byCode.get('signature')),
  };
}

export function mapEmailAccount(raw: unknown): EmailAccountDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Json;
  const id = str(r.id) ?? str(r.hashId);
  const fromEmail = str(r.fromEmail);
  if (!id || !fromEmail) return null;
  const fromName = str(r.fromName) ?? '';
  const client =
    r.client && typeof r.client === 'object' && str((r.client as Json).id)
      ? { id: str((r.client as Json).id)!, name: fullName(r.client) ?? '' }
      : null;
  const sequences = (Array.isArray(r.sequences) ? r.sequences : [])
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const sid = str((s as Json).id);
      if (!sid) return null;
      return {
        id: sid,
        title: str((s as Json).title) ?? sid,
        active: (s as Json).active === true,
      };
    })
    .filter((s): s is { id: string; title: string; active: boolean } => s !== null);

  return {
    id,
    fromName,
    fromEmail,
    senderFirstName: fromName.split(/\s+/)[0] ?? '',
    provider: str(r.emailServiceProvider),
    type: accountType(r.type),
    status: emailAccountStatusFromCode(r.status),
    isDefault: r.isDefault === true,
    healthScore: num(r.healthScore),
    createdAt: str(r.createdAt),
    addedBy: fullName(r.user),
    client,
    sequences,
    settings: settingsFrom(r.settings),
  };
}
