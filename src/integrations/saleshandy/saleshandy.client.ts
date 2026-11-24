import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SaleshandyHttpService } from './saleshandy-http.service';

/** Saleshandy verification of a revealed email (`bad` is never outreach-ready). */
export type SaleshandyEmailStatus = 'valid' | 'risky' | 'bad' | 'unknown';

export type SaleshandyPerson = {
  id: number;
  fullName: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  department?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  decisionMaker: boolean;
  isRevealed: boolean;
};

export type SaleshandyEnrichedContact = {
  fullName: string;
  jobTitle?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  emails: Array<{ email: string; status: SaleshandyEmailStatus }>;
};

export type SaleshandyEnrichResult = {
  ok: boolean;
  contacts: SaleshandyEnrichedContact[];
  creditsCharged: number;
  requestId?: string;
  error?: string;
};

type Json = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toStatus(value: unknown): SaleshandyEmailStatus {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  return v === 'valid' || v === 'risky' || v === 'bad' ? v : 'unknown';
}

/**
 * Saleshandy Open API (Lead Finder search + contact enrichment).
 * Search is free; enrichment spends credits and returns verified emails.
 */
@Injectable()
export class SaleshandyClient {
  private readonly logger = new Logger(SaleshandyClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: SaleshandyHttpService,
  ) {}

  private get apiKey(): string {
    return this.config.get<string>('SALESHANDY_API_KEY')?.trim() ?? '';
  }

  isEnabled(): boolean {
    return (
      this.config.get<boolean>('SALESHANDY_ENRICHMENT_ENABLED') === true &&
      this.apiKey.length > 0
    );
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Json | null }> {
    const { status, json } = await this.http.raw(method, path, {
      body,
      timeoutMs: 30_000,
    });
    return { status, json };
  }

  private static errorOf(json: Json | null, status: number): string {
    const message = json?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('; ');
    return `http_${status}`;
  }

  async getCredits(): Promise<number | null> {
    try {
      const { status, json } = await this.request('GET', '/credits');
      const payload = json?.payload as Json | undefined;
      if (status >= 400 || typeof payload?.totalCredits !== 'number') {
        return null;
      }
      return payload.totalCredits;
    } catch {
      return null;
    }
  }

  /** Lead Finder people at a domain filtered by title keywords (free). */
  async searchPeopleByDomain(
    domain: string,
    titleKeywords: string[],
  ): Promise<{ ok: boolean; people: SaleshandyPerson[]; error?: string }> {
    try {
      const { status, json } = await this.request('POST', '/search/people', {
        company_domain: { includes: [domain] },
        job_title: { includes: titleKeywords, exactMatch: 0 },
        page: 1,
      });
      if (status >= 400) {
        return {
          ok: false,
          people: [],
          error: SaleshandyClient.errorOf(json, status),
        };
      }
      // Zero matches: `payload` is the literal empty array.
      const payload = json?.payload;
      const rows =
        payload && !Array.isArray(payload) && typeof payload === 'object'
          ? ((payload as Json).people as unknown[] | undefined)
          : [];
      const people: SaleshandyPerson[] = [];
      for (const row of rows ?? []) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Json;
        const fullName = str(r.full_name);
        if (typeof r.id !== 'number' || !fullName) continue;
        people.push({
          id: r.id,
          fullName,
          firstName: str(r.first_name),
          lastName: str(r.last_name),
          jobTitle: str(r.job_title),
          department: str(r.department),
          companyDomain: str(r.company_domain)?.toLowerCase(),
          linkedinUrl: str(r.linkedin_url),
          decisionMaker: r.decision_maker === true,
          isRevealed: r.isRevealed === true,
        });
      }
      return { ok: true, people };
    } catch (error) {
      return {
        ok: false,
        people: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Reveal work emails (async job: submit → poll status → fetch result).
   * Pass Lead Finder ids and/or LinkedIn profile URLs (max 100 each).
   */
  async enrichContacts(
    input: { leadIds?: number[]; linkedinUrls?: string[] },
    options: { timeoutMs: number; pollIntervalMs?: number },
  ): Promise<SaleshandyEnrichResult> {
    const leadIds = (input.leadIds ?? []).slice(0, 100);
    const linkedinUrls = (input.linkedinUrls ?? []).slice(0, 100);
    if (leadIds.length === 0 && linkedinUrls.length === 0) {
      return { ok: true, contacts: [], creditsCharged: 0 };
    }
    try {
      const submit = await this.request('POST', '/enrich/contact', {
        ...(leadIds.length ? { lead_id: leadIds } : {}),
        ...(linkedinUrls.length ? { linkedin_url: linkedinUrls } : {}),
        email_type: 'work_email',
        reveal_phone: false,
      });
      const requestId = str((submit.json?.payload as Json | undefined)?.requestId);
      if (submit.status >= 400 || !requestId) {
        return {
          ok: false,
          contacts: [],
          creditsCharged: 0,
          error: SaleshandyClient.errorOf(submit.json, submit.status),
        };
      }

      const deadline = Date.now() + options.timeoutMs;
      const interval = options.pollIntervalMs ?? 5_000;
      let state = 'in-progress';
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        const poll = await this.request('GET', `/enrich/status/${requestId}`);
        state = str((poll.json?.payload as Json | undefined)?.status) ?? state;
        if (state === 'completed' || state === 'failed') break;
      }
      if (state !== 'completed') {
        return {
          ok: false,
          contacts: [],
          creditsCharged: 0,
          requestId,
          error: state === 'failed' ? 'enrich_failed' : 'enrich_timeout',
        };
      }

      const result = await this.request(
        'GET',
        `/enrich/status/result/${requestId}`,
      );
      const payload = (result.json?.payload as Json | undefined) ?? {};
      const contacts: SaleshandyEnrichedContact[] = [];
      for (const row of (payload.results as unknown[] | undefined) ?? []) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Json;
        const fullName = str(r.full_name);
        if (!fullName) continue;
        const emails: SaleshandyEnrichedContact['emails'] = [];
        for (const e of (r.emails as unknown[] | undefined) ?? []) {
          const rec = e as Json;
          const email = str(rec?.email)?.toLowerCase();
          if (email) emails.push({ email, status: toStatus(rec.verificationStatus) });
        }
        const social = Array.isArray(r.social_link)
          ? (r.social_link as unknown[]).map(str).find((u) => u?.includes('linkedin.com/in'))
          : undefined;
        contacts.push({
          fullName,
          jobTitle: str(r.job_title),
          companyDomain: str(r.company_domain)?.toLowerCase(),
          linkedinUrl: str(r.linkedin_url) ?? social,
          emails,
        });
      }
      const creditsCharged =
        typeof payload.creditsCharged === 'number' ? payload.creditsCharged : 0;
      this.logger.log(
        JSON.stringify({
          event: 'saleshandy_enrich_completed',
          requestId,
          submitted: leadIds.length + linkedinUrls.length,
          contacts: contacts.length,
          creditsCharged,
        }),
      );
      return { ok: true, contacts, creditsCharged, requestId };
    } catch (error) {
      return {
        ok: false,
        contacts: [],
        creditsCharged: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
