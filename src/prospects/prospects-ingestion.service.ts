import { Injectable, Logger } from '@nestjs/common';

import type {
  Prisma,
  Prospect,
  ProspectSource,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  domainOf,
  isValidEmail,
  mergeAttributes,
  mergeTags,
  normalizeEmail,
  splitName,
  type ConflictAction,
  type ProspectAttributes,
} from './prospects.mapper';

export const APPROVAL_SOURCE_TYPES = [
  'LEAD',
  'BRAND_CONTACT',
  'AGENCY_CONTACT',
] as const;
export type ApprovalSourceType = (typeof APPROVAL_SOURCE_TYPES)[number];

export type ApprovalItem = {
  type: ApprovalSourceType;
  id: string;
  /** Required for agency contacts (an agency can belong to several talents). */
  influencerId?: string;
};

export type ApprovalResult = {
  type: ApprovalSourceType;
  id: string;
  outcome: 'created' | 'updated' | 'unchanged' | 'skipped';
  prospectId?: string;
  reason?:
    | 'NOT_FOUND'
    | 'NO_VALID_EMAIL'
    | 'INFLUENCER_REQUIRED'
    | 'AGENCY_NOT_LINKED';
};

type Links = Pick<
  Prisma.ProspectUncheckedCreateInput,
  | 'brandCandidateId'
  | 'brandBusinessContactId'
  | 'leadId'
  | 'agencyId'
  | 'agencyContactId'
>;

export type UpsertInput = {
  influencerId: string;
  email: string;
  source: ProspectSource;
  links?: Links;
  attributes: ProspectAttributes;
  tags?: string[];
  createdById?: string | null;
};

type Tx = Prisma.TransactionClient;

const LINK_KEYS: Array<keyof Links> = [
  'brandCandidateId',
  'brandBusinessContactId',
  'leadId',
  'agencyId',
  'agencyContactId',
];

/**
 * Turns approved discovered contacts into prospects (product decision
 * 2026-11-26: prospects are created on "Approve", not automatically).
 * Never invents names (RF-01): mailboxes keep firstName/lastName null.
 */
@Injectable()
export class ProspectsIngestionService {
  private readonly logger = new Logger(ProspectsIngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or merges a prospect keyed by (influencerId, normalized email).
   * Reactivates archived prospects unless `action` is `noUpdate`.
   */
  async upsert(
    tx: Tx,
    input: UpsertInput,
    action: ConflictAction = 'addMissingFields',
  ): Promise<{
    prospect: Prospect;
    outcome: 'created' | 'updated' | 'unchanged' | 'skipped';
  }> {
    const emailNormalized = normalizeEmail(input.email);
    const existing = await tx.prospect.findUnique({
      where: {
        influencerId_emailNormalized: {
          influencerId: input.influencerId,
          emailNormalized,
        },
      },
    });
    if (!existing) {
      const prospect = await tx.prospect.create({
        data: {
          influencerId: input.influencerId,
          email: input.email.trim(),
          emailNormalized,
          source: input.source,
          ...input.links,
          ...input.attributes,
          tags: mergeTags([], input.tags),
          createdById: input.createdById ?? null,
        },
      });
      return { prospect, outcome: 'created' };
    }
    if (action === 'noUpdate')
      return { prospect: existing, outcome: 'skipped' };

    const data: Prisma.ProspectUncheckedUpdateInput = {
      ...mergeAttributes(existing, input.attributes, action),
    };
    for (const key of LINK_KEYS) {
      const value = input.links?.[key];
      if (value && !existing[key]) data[key] = value;
    }
    const tags = mergeTags(existing.tags, input.tags);
    if (tags.length !== existing.tags.length) data.tags = tags;
    if (existing.status === 'ARCHIVED') data.status = 'ACTIVE';
    if (Object.keys(data).length === 0)
      return { prospect: existing, outcome: 'unchanged' };
    const prospect = await tx.prospect.update({
      where: { id: existing.id },
      data,
    });
    return { prospect, outcome: 'updated' };
  }

  async approve(
    items: ApprovalItem[],
    userId?: string,
  ): Promise<ApprovalResult[]> {
    const results: ApprovalResult[] = [];
    for (const item of items) {
      const input = await this.buildInput(item);
      if ('reason' in input) {
        results.push({
          type: item.type,
          id: item.id,
          outcome: 'skipped',
          reason: input.reason,
        });
        continue;
      }
      const { prospect, outcome } = await this.prisma.$transaction(
        async (tx) => {
          if (item.type === 'LEAD') {
            await tx.lead.update({
              where: { id: item.id },
              data: { status: 'APPROVED' },
            });
          }
          return this.upsert(tx, { ...input, createdById: userId ?? null });
        },
      );
      results.push({
        type: item.type,
        id: item.id,
        outcome,
        prospectId: prospect.id,
      });
    }
    this.logger.log(
      JSON.stringify({
        event: 'prospects_approved',
        items: items.length,
        created: results.filter((r) => r.outcome === 'created').length,
        skipped: results.filter((r) => r.outcome === 'skipped').length,
      }),
    );
    return results;
  }

  /** "Remove from Prospects": archives the prospect created from that contact (keeps history). */
  async unapprove(items: ApprovalItem[]): Promise<{ archived: number }> {
    let archived = 0;
    for (const item of items) {
      const where: Prisma.ProspectWhereInput = {
        status: 'ACTIVE',
        ...(item.type === 'LEAD' ? { leadId: item.id } : {}),
        ...(item.type === 'BRAND_CONTACT'
          ? { brandBusinessContactId: item.id }
          : {}),
        ...(item.type === 'AGENCY_CONTACT'
          ? {
              agencyContactId: item.id,
              ...(item.influencerId ? { influencerId: item.influencerId } : {}),
            }
          : {}),
      };
      const res = await this.prisma.prospect.updateMany({
        where,
        data: { status: 'ARCHIVED' },
      });
      archived += res.count;
    }
    return { archived };
  }

  /**
   * Hook for the existing lead review flow (PATCH /lead-discovery/leads/:id):
   * APPROVED creates/merges the prospect; DISCARDED/DUPLICATE archives it.
   * Never throws: lead review must not fail because of prospects.
   */
  async onLeadStatusChanged(leadId: string, status: string): Promise<void> {
    try {
      if (status === 'APPROVED') {
        const input = await this.buildInput({ type: 'LEAD', id: leadId });
        if ('reason' in input) return;
        await this.prisma.$transaction((tx) => this.upsert(tx, input));
      } else if (status === 'DISCARDED' || status === 'DUPLICATE') {
        await this.unapprove([{ type: 'LEAD', id: leadId }]);
      }
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'prospect_lead_hook_failed',
          leadId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  /** One-time backfill: prospects for leads already APPROVED before this module. */
  async backfillApprovedLeads(): Promise<{
    scanned: number;
    created: number;
    skipped: number;
  }> {
    const leads = await this.prisma.lead.findMany({
      where: { status: 'APPROVED', prospects: { none: {} } },
      select: { id: true },
    });
    const results = await this.approve(
      leads.map((l) => ({ type: 'LEAD' as const, id: l.id })),
    );
    return {
      scanned: leads.length,
      created: results.filter((r) => r.outcome === 'created').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
    };
  }

  /** Ids of contacts that already have an active prospect (drives the "Approved" state in the UI). */
  async approvedIds(influencerId: string) {
    const rows = await this.prisma.prospect.findMany({
      where: { influencerId, status: 'ACTIVE' },
      select: {
        leadId: true,
        brandBusinessContactId: true,
        agencyContactId: true,
      },
    });
    const pick = (k: 'leadId' | 'brandBusinessContactId' | 'agencyContactId') =>
      rows.map((r) => r[k]).filter((v): v is string => !!v);
    return {
      leadIds: pick('leadId'),
      brandBusinessContactIds: pick('brandBusinessContactId'),
      agencyContactIds: pick('agencyContactId'),
    };
  }

  private async buildInput(
    item: ApprovalItem,
  ): Promise<
    | Omit<UpsertInput, 'createdById'>
    | { reason: NonNullable<ApprovalResult['reason']> }
  > {
    if (item.type === 'LEAD') return this.fromLead(item.id);
    if (item.type === 'BRAND_CONTACT') return this.fromBrandContact(item.id);
    return this.fromAgencyContact(item.id, item.influencerId);
  }

  private async fromLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        brandCandidate: {
          select: { id: true, name: true, website: true, domain: true },
        },
        contactChannels: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!lead) return { reason: 'NOT_FOUND' as const };
    const email = [
      lead.email,
      ...lead.contactChannels
        .filter((c) => c.type === 'EMAIL')
        .map((c) => c.value),
    ]
      .map((e) => e?.trim())
      .find((e): e is string => !!e && isValidEmail(e));
    if (!email || lead.emailConfidence === 'INVALID')
      return { reason: 'NO_VALID_EMAIL' as const };
    const person = !lead.isGeneric;
    const linkedIn =
      lead.contactChannels.find((c) => c.type === 'LINKEDIN')?.value ??
      (lead.profileUrl?.includes('linkedin.com') ? lead.profileUrl : null);
    return {
      influencerId: lead.influencerId,
      email,
      source: 'LEAD' as const,
      links: { leadId: lead.id, brandCandidateId: lead.brandCandidateId },
      attributes: {
        ...(person ? splitName(lead.contactName) : {}),
        jobTitle: person ? lead.title : null,
        contactKind: person ? ('PERSON' as const) : ('MAILBOX' as const),
        isGeneric: !person,
        mailboxLabel: person ? null : lead.contactName || null,
        company: lead.brandCandidate.name,
        companyDomain:
          lead.brandCandidate.domain || domainOf(lead.brandCandidate.website),
        website: lead.brandCandidate.website,
        linkedInUrl: linkedIn,
      },
    };
  }

  private async fromBrandContact(contactId: string) {
    const contact = await this.prisma.brandBusinessContact.findUnique({
      where: { id: contactId },
      include: {
        brandCandidate: {
          select: {
            id: true,
            influencerId: true,
            name: true,
            website: true,
            domain: true,
          },
        },
      },
    });
    if (!contact) return { reason: 'NOT_FOUND' as const };
    if (!isValidEmail(contact.email))
      return { reason: 'NO_VALID_EMAIL' as const };
    const brand = contact.brandCandidate;
    return {
      influencerId: brand.influencerId,
      email: contact.email,
      source: 'BRAND_CONTACT' as const,
      links: { brandBusinessContactId: contact.id, brandCandidateId: brand.id },
      attributes: {
        // Brand inboxes carry no person name: keep firstName empty (RF-01).
        contactKind: 'MAILBOX' as const,
        isGeneric: contact.isGeneric,
        mailboxLabel: contact.label,
        commercialRelevance: contact.commercialRelevance,
        company: brand.name,
        companyDomain: brand.domain || domainOf(brand.website),
        website: brand.website,
      },
    };
  }

  private async fromAgencyContact(contactId: string, influencerId?: string) {
    if (!influencerId) return { reason: 'INFLUENCER_REQUIRED' as const };
    const contact = await this.prisma.agencyContact.findUnique({
      where: { id: contactId },
      include: {
        agency: {
          select: {
            id: true,
            name: true,
            website: true,
            domain: true,
            country: true,
            influencerAgencies: {
              where: { influencerId },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!contact) return { reason: 'NOT_FOUND' as const };
    if (contact.agency.influencerAgencies.length === 0)
      return { reason: 'AGENCY_NOT_LINKED' as const };
    if (!isValidEmail(contact.email))
      return { reason: 'NO_VALID_EMAIL' as const };
    const person = contact.contactKind === 'PERSON' && !contact.isGeneric;
    return {
      influencerId,
      email: contact.email,
      source: 'AGENCY_CONTACT' as const,
      links: { agencyContactId: contact.id, agencyId: contact.agency.id },
      attributes: {
        ...(person ? splitName(contact.displayName) : {}),
        jobTitle: person ? contact.title : null,
        contactKind: person ? ('PERSON' as const) : ('MAILBOX' as const),
        isGeneric: !person,
        mailboxLabel: person ? null : contact.label,
        commercialRelevance: contact.commercialRelevance,
        company: contact.agency.name,
        companyDomain:
          contact.agency.domain || domainOf(contact.agency.website),
        website: contact.agency.website,
        country: contact.agency.country,
      },
      tags: ['Agencia'],
    };
  }
}
