import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Prisma } from '../../generated/prisma/client';
import {
  ContactChannelSource,
  ContactChannelType,
  LeadEmailConfidence,
  LeadStatus,
} from '../../generated/prisma/enums';
import {
  SaleshandyClient,
  type SaleshandyEmailStatus,
  type SaleshandyEnrichedContact,
} from '../../integrations/saleshandy/saleshandy.client';
import {
  ContactChannelService,
  type CreateChannelInput,
} from '../../lead-discovery/contact-channel.service';
import { classifyPublicEmailGeneric } from '../../lead-discovery/utils/public-email-generic.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  rankCollaborationRole,
  SALESHANDY_TITLE_KEYWORDS,
} from './saleshandy-roles.util';

export const SALESHANDY_PROVIDER_ID = 'saleshandy';
export const SALESHANDY_LEAD_SOURCE = 'saleshandy-lead-finder';

export type SaleshandyBrandContext = {
  brandCandidateId: string;
  influencerId: string;
  runId: string;
  domain: string;
};

export type SaleshandyTrace = {
  enabled: boolean;
  skippedReason?: 'DISABLED' | 'LOW_CREDITS' | 'NO_BUDGET';
  creditsBefore?: number | null;
  peopleFound: number;
  peopleRanked: number;
  reusedFromKnowledgeBase: number;
  submitted: number;
  creditsCharged: number;
  leadsCreated: number;
  leadsUpdated: number;
  validEmails: number;
  riskyEmails: number;
  badEmails: number;
  linkedinSubmitted: number;
  /** People whose revealed emails all belong to another company (likely left). */
  offDomainSkipped: number;
  errors: string[];
};

export function emptySaleshandyTrace(enabled: boolean): SaleshandyTrace {
  return {
    enabled,
    peopleFound: 0,
    peopleRanked: 0,
    reusedFromKnowledgeBase: 0,
    submitted: 0,
    creditsCharged: 0,
    leadsCreated: 0,
    leadsUpdated: 0,
    validEmails: 0,
    riskyEmails: 0,
    badEmails: 0,
    linkedinSubmitted: 0,
    offDomainSkipped: 0,
    errors: [],
  };
}

export function normalizeLinkedInProfile(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname.toLowerCase().endsWith('linkedin.com')) return null;
    const slug = url.pathname.replace(/\/+$/, '').match(/^\/in\/([^/]+)/i)?.[1];
    if (!slug) return null;
    return `https://www.linkedin.com/in/${decodeURIComponent(slug).trim().replace(/\s+/g, '-').toLowerCase()}`;
  } catch {
    return null;
  }
}

const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);

/** Approximate registrable domain (`us.maje.com` → `maje.com`, `x.co.uk` → `x.co.uk`). */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const take =
    labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2])
      ? 3
      : 2;
  return labels.slice(-take).join('.');
}

/** True when the email belongs to the brand (same registrable domain). */
export function isBrandEmail(email: string, brandDomain: string): boolean {
  const host = email.split('@')[1]?.toLowerCase();
  return Boolean(host) && registrableDomain(host) === registrableDomain(brandDomain);
}

function confidenceOf(status: SaleshandyEmailStatus): LeadEmailConfidence {
  switch (status) {
    case 'valid':
      return LeadEmailConfidence.VALID;
    case 'risky':
      return LeadEmailConfidence.PROBABLE;
    case 'bad':
      return LeadEmailConfidence.INVALID;
    default:
      return LeadEmailConfidence.UNKNOWN;
  }
}

/** Window in which a domain's reveal budget is shared by every run/influencer. */
const REVEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REVEAL_LOG = 50;

type RevealEntry = { key: string; at: string };

const STATUS_ORDER: Record<SaleshandyEmailStatus, number> = {
  valid: 0,
  risky: 1,
  unknown: 2,
  bad: 3,
};

/**
 * Enrichment waterfall level 1/2 (strategy doc): Saleshandy Lead Finder by
 * brand domain + target roles (free search), then reveal verified work emails
 * for the best-ranked people within a per-brand credit budget. Emails are
 * provider-verified literals (RF-01: never guessed). Soft-fail: never throws.
 */
@Injectable()
export class SaleshandyEnrichmentService {
  private readonly logger = new Logger(SaleshandyEnrichmentService.name);

  constructor(
    private readonly client: SaleshandyClient,
    private readonly prisma: PrismaService,
    private readonly contactChannels: ContactChannelService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.client.isEnabled();
  }

  /** Credits a brand may spend across both passes. */
  maxEnrichPerBrand(): number {
    return this.config.get<number>('SALESHANDY_MAX_ENRICH_PER_BRAND') ?? 2;
  }

  private timeoutMs(): number {
    return this.config.get<number>('SALESHANDY_ENRICH_TIMEOUT_MS') ?? 150_000;
  }

  private async hasCredits(trace: SaleshandyTrace): Promise<boolean> {
    const min = this.config.get<number>('SALESHANDY_MIN_CREDITS') ?? 20;
    const credits = await this.client.getCredits();
    trace.creditsBefore = credits;
    // Unknown balance: let the enrich call decide (it fails without credits).
    return credits === null || credits >= min;
  }

  /**
   * Pass 1: domain search → reuse emails already revealed for this domain
   * (shared knowledge base) → reveal the top-ranked remaining people.
   */
  async enrichByDomain(ctx: SaleshandyBrandContext): Promise<SaleshandyTrace> {
    const trace = emptySaleshandyTrace(this.isEnabled());
    if (!trace.enabled) {
      trace.skippedReason = 'DISABLED';
      return trace;
    }
    try {
      trace.reusedFromKnowledgeBase = await this.reuseKnownContacts(ctx, trace);

      const search = await this.client.searchPeopleByDomain(
        ctx.domain,
        SALESHANDY_TITLE_KEYWORDS,
      );
      if (!search.ok && search.error) trace.errors.push(`search: ${search.error}`);
      // Lead Finder matches by keyword: keep only people at this exact domain.
      const atDomain = search.people.filter(
        (p) => !p.companyDomain || p.companyDomain === ctx.domain,
      );
      trace.peopleFound = atDomain.length;

      const known = await this.knownNames(ctx);
      const reveals = await this.revealLog(ctx.domain);
      const revealedKeys = new Set(reveals.map((r) => r.key));
      const ranked = atDomain
        .map((p) => ({ p, score: rankCollaborationRole(p.jobTitle, p.decisionMaker) }))
        .filter(
          ({ p, score }) =>
            score > 0 &&
            !known.has(p.fullName.toLowerCase()) &&
            !revealedKeys.has(`id:${p.id}`),
        )
        .sort((a, b) => b.score - a.score);
      trace.peopleRanked = ranked.length;

      const budget = this.remainingBudget(reveals, trace);
      if (budget <= 0 || ranked.length === 0) {
        if (budget <= 0) trace.skippedReason = 'NO_BUDGET';
        return trace;
      }
      if (!(await this.hasCredits(trace))) {
        trace.skippedReason = 'LOW_CREDITS';
        return trace;
      }

      const picked = ranked.slice(0, budget).map(({ p }) => p);
      trace.submitted = picked.length;
      // Record before spending: a crash/retry must not buy the same budget twice.
      await this.recordReveals(ctx.domain, reveals, picked.map((p) => `id:${p.id}`));
      const result = await this.client.enrichContacts(
        { leadIds: picked.map((p) => p.id) },
        { timeoutMs: this.timeoutMs() },
      );
      trace.creditsCharged += result.creditsCharged;
      if (!result.ok && result.error) trace.errors.push(`enrich: ${result.error}`);

      for (const contact of result.contacts) {
        const fallback = picked.find(
          (p) => p.fullName.toLowerCase() === contact.fullName.toLowerCase(),
        );
        await this.persist(ctx, contact, fallback?.jobTitle, trace, 'domain');
      }
    } catch (error) {
      trace.errors.push(error instanceof Error ? error.message : String(error));
    }
    this.log(ctx, trace, 'domain');
    return trace;
  }

  /**
   * Pass 2: LinkedIn profiles found by Bright Data (Track 2B) that still have
   * no email → reveal through Saleshandy with the remaining brand budget.
   */
  async enrichLinkedInLeads(
    ctx: SaleshandyBrandContext,
    trace: SaleshandyTrace,
  ): Promise<SaleshandyTrace> {
    if (!trace.enabled) return trace;
    try {
      const reveals = await this.revealLog(ctx.domain);
      const revealedKeys = new Set(reveals.map((r) => r.key));
      const remaining = this.remainingBudget(reveals, trace);
      if (remaining <= 0) return trace;

      const leads = await this.prisma.lead.findMany({
        where: {
          brandCandidateId: ctx.brandCandidateId,
          runId: ctx.runId,
          email: null,
          profileUrl: { not: null },
        },
        select: { profileUrl: true, title: true },
      });
      const urls = leads
        .filter((l) => rankCollaborationRole(l.title) > 0 || !l.title)
        .sort((a, b) => rankCollaborationRole(b.title) - rankCollaborationRole(a.title))
        .map((l) => normalizeLinkedInProfile(l.profileUrl))
        .filter((u): u is string => Boolean(u) && !revealedKeys.has(`li:${u}`))
        .slice(0, remaining);
      if (urls.length === 0) return trace;
      if (trace.creditsBefore === undefined && !(await this.hasCredits(trace))) {
        trace.skippedReason = 'LOW_CREDITS';
        return trace;
      }

      trace.linkedinSubmitted = urls.length;
      await this.recordReveals(ctx.domain, reveals, urls.map((u) => `li:${u}`));
      const result = await this.client.enrichContacts(
        { linkedinUrls: urls },
        { timeoutMs: this.timeoutMs() },
      );
      trace.creditsCharged += result.creditsCharged;
      if (!result.ok && result.error) trace.errors.push(`enrich_linkedin: ${result.error}`);
      for (const contact of result.contacts) {
        await this.persist(ctx, contact, undefined, trace, 'linkedin');
      }
    } catch (error) {
      trace.errors.push(error instanceof Error ? error.message : String(error));
    }
    this.log(ctx, trace, 'linkedin');
    return trace;
  }

  /** True when this run already holds a verified nominal email (Tier 1). */
  hasTier1(trace: SaleshandyTrace): boolean {
    return trace.validEmails > 0 || trace.reusedFromKnowledgeBase > 0;
  }

  /**
   * Per-domain budget over a 30-day window, shared by every run and influencer
   * (reused contacts are free; retries never re-spend).
   */
  private remainingBudget(reveals: RevealEntry[], trace: SaleshandyTrace): number {
    const since = Date.now() - REVEAL_WINDOW_MS;
    const recent = reveals.filter((r) => Date.parse(r.at) >= since).length;
    return Math.max(
      0,
      this.maxEnrichPerBrand() - recent - trace.reusedFromKnowledgeBase,
    );
  }

  /** Reveal log kept on the shared Brand row (BKB `contactYield.saleshandy`). */
  private async revealLog(domain: string): Promise<RevealEntry[]> {
    const brand = await this.prisma.brand.findUnique({
      where: { domain },
      select: { contactYield: true },
    });
    const yieldJson = brand?.contactYield as
      | { saleshandy?: { reveals?: unknown } }
      | null
      | undefined;
    const list = yieldJson?.saleshandy?.reveals;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (r): r is RevealEntry =>
        Boolean(r) &&
        typeof (r as RevealEntry).key === 'string' &&
        typeof (r as RevealEntry).at === 'string',
    );
  }

  private async recordReveals(
    domain: string,
    previous: RevealEntry[],
    keys: string[],
  ): Promise<void> {
    if (keys.length === 0) return;
    const at = new Date().toISOString();
    const reveals = [...previous, ...keys.map((key) => ({ key, at }))].slice(
      -MAX_REVEAL_LOG,
    );
    const brand = await this.prisma.brand.findUnique({
      where: { domain },
      select: { contactYield: true },
    });
    if (!brand) return;
    const current =
      brand.contactYield && typeof brand.contactYield === 'object'
        ? (brand.contactYield as Record<string, unknown>)
        : {};
    await this.prisma.brand.update({
      where: { domain },
      data: {
        contactYield: {
          ...current,
          saleshandy: { reveals, lastRevealAt: at },
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async knownNames(ctx: SaleshandyBrandContext): Promise<Set<string>> {
    const rows = await this.prisma.lead.findMany({
      where: { brandCandidateId: ctx.brandCandidateId, email: { not: null } },
      select: { contactName: true },
    });
    return new Set(rows.map((r) => r.contactName.toLowerCase()));
  }

  /**
   * Shared B2B memory: Saleshandy emails revealed for the same domain under
   * another brand candidate (other influencer/manager) are copied, not re-bought.
   */
  private async reuseKnownContacts(
    ctx: SaleshandyBrandContext,
    trace: SaleshandyTrace,
  ): Promise<number> {
    const rows = await this.prisma.lead.findMany({
      where: {
        source: SALESHANDY_LEAD_SOURCE,
        email: { not: null },
        status: { notIn: [LeadStatus.DISCARDED, LeadStatus.DUPLICATE] },
        emailConfidence: { in: [LeadEmailConfidence.VALID, LeadEmailConfidence.PROBABLE] },
        brandCandidate: { domain: ctx.domain },
        brandCandidateId: { not: ctx.brandCandidateId },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        contactName: true,
        title: true,
        email: true,
        emailConfidence: true,
        profileUrl: true,
      },
      take: 20,
    });
    const seen = new Set<string>();
    let reused = 0;
    for (const row of rows) {
      const email = row.email!.toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      await this.persist(
        ctx,
        {
          fullName: row.contactName,
          jobTitle: row.title ?? undefined,
          linkedinUrl: row.profileUrl ?? undefined,
          emails: [
            {
              email,
              status:
                row.emailConfidence === LeadEmailConfidence.VALID ? 'valid' : 'risky',
            },
          ],
        },
        row.title ?? undefined,
        trace,
        'knowledge_base',
      );
      reused += 1;
    }
    return reused;
  }

  private async persist(
    ctx: SaleshandyBrandContext,
    contact: SaleshandyEnrichedContact,
    fallbackTitle: string | undefined,
    trace: SaleshandyTrace,
    via: 'domain' | 'linkedin' | 'knowledge_base',
  ): Promise<void> {
    // Only the brand's own emails count. If every revealed email belongs to
    // another company, the person most likely left: do not store them.
    const brandEmails = contact.emails.filter((e) => isBrandEmail(e.email, ctx.domain));
    if (contact.emails.length > 0 && brandEmails.length === 0) {
      trace.offDomainSkipped += 1;
      return;
    }
    const best = [...brandEmails].sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    )[0];
    if (via !== 'knowledge_base') {
      if (best?.status === 'valid') trace.validEmails += 1;
      else if (best?.status === 'risky') trace.riskyEmails += 1;
      else if (best?.status === 'bad') trace.badEmails += 1;
    }
    // `bad` = undeliverable: keep the person (Tier 3) but never the email.
    const usable = best && best.status !== 'bad' ? best : undefined;
    const profileUrl = normalizeLinkedInProfile(contact.linkedinUrl);
    const title = contact.jobTitle ?? fallbackTitle ?? null;

    const existing = await this.prisma.lead.findFirst({
      where: {
        brandCandidateId: ctx.brandCandidateId,
        OR: [
          ...(profileUrl ? [{ profileUrl }] : []),
          ...(usable ? [{ email: usable.email }] : []),
          { contactName: { equals: contact.fullName, mode: 'insensitive' as const } },
        ],
      },
      select: { id: true },
    });

    const metadata = {
      track: 'SALESHANDY',
      via,
      verificationStatus: usable?.status ?? best?.status ?? 'none',
    } as Prisma.InputJsonValue;

    const leadId = await this.prisma.$transaction(async (tx) => {
      const data = {
        contactName: contact.fullName,
        title,
        ...(usable
          ? {
              email: usable.email,
              emailConfidence: confidenceOf(usable.status),
              isGeneric: classifyPublicEmailGeneric(usable.email),
            }
          : {}),
        ...(profileUrl ? { profileUrl } : {}),
        runId: ctx.runId,
        metadata,
      };
      if (existing) {
        await tx.lead.update({ where: { id: existing.id }, data });
        return existing.id;
      }
      const created = await tx.lead.create({
        data: {
          ...data,
          brandCandidateId: ctx.brandCandidateId,
          influencerId: ctx.influencerId,
          providerId: SALESHANDY_PROVIDER_ID,
          source: SALESHANDY_LEAD_SOURCE,
        },
        select: { id: true },
      });
      return created.id;
    });
    if (existing) trace.leadsUpdated += 1;
    else trace.leadsCreated += 1;

    const channels: CreateChannelInput[] = [];
    if (profileUrl) {
      channels.push({
        type: ContactChannelType.LINKEDIN,
        value: profileUrl,
        source: ContactChannelSource.SALESHANDY,
        sourceUrl: profileUrl,
      });
    }
    if (usable) {
      channels.push({
        type: ContactChannelType.EMAIL,
        value: usable.email,
        source: ContactChannelSource.SALESHANDY,
        isGeneric: classifyPublicEmailGeneric(usable.email),
        metadata: {
          discoveryStatus: 'FOUND',
          attributionStatus: 'ATTRIBUTED',
          verificationStatus: usable.status === 'valid' ? 'VALID' : 'CATCH_ALL',
          verifiedBy: 'saleshandy',
          sourceKind: 'saleshandy',
          via,
          verifiedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      });
    }
    if (channels.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await this.contactChannels.createChannelsForLead(tx, leadId, channels);
      });
    }
  }

  private log(
    ctx: SaleshandyBrandContext,
    trace: SaleshandyTrace,
    pass: 'domain' | 'linkedin',
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'saleshandy_enrichment_pass',
        pass,
        runId: ctx.runId,
        domain: ctx.domain,
        ...trace,
      }),
    );
  }
}
