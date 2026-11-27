import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { CustomField, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProspectsIngestionService } from './prospects-ingestion.service';
import {
  columnForFieldKey,
  domainOf,
  isValidEmail,
  normalizeEmail,
  type ConflictAction,
  type ProspectAttributes,
} from './prospects.mapper';

export const CSV_MAX_ROWS = 5000;
const CHUNK_SIZE = 200;
const MAX_ERRORS_KEPT = 200;

const GENERIC_LOCAL_PARTS = new Set([
  'info',
  'hello',
  'hi',
  'contact',
  'contacto',
  'team',
  'office',
  'admin',
  'sales',
  'ventas',
  'marketing',
  'press',
  'pr',
  'media',
  'partnerships',
  'partners',
  'collabs',
  'collaborations',
  'influencers',
  'creators',
  'affiliates',
  'support',
  'help',
  'care',
  'customerservice',
  'hola',
]);

export type CsvRowError = { row: number; email: string | null; reason: string };

export type CsvImportResult = {
  jobId: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: CsvRowError[];
};

type FieldValueResult = { ok: true; value: string } | { ok: false };

/** Validates and normalizes a CSV cell for a CustomField type. */
export function normalizeFieldValue(
  field: Pick<CustomField, 'fieldType' | 'metadata'>,
  raw: string,
): FieldValueResult {
  const value = raw.trim();
  switch (field.fieldType) {
    case 'NUMBER':
    case 'CURRENCY': {
      const num = Number(value.replace(/[,\s$€£]/g, ''));
      return Number.isFinite(num)
        ? { ok: true, value: String(num) }
        : { ok: false };
    }
    case 'DATE': {
      const time = Date.parse(value);
      return Number.isNaN(time)
        ? { ok: false }
        : { ok: true, value: new Date(time).toISOString().slice(0, 10) };
    }
    case 'DROPDOWN': {
      const options = (field.metadata as { options?: string[] } | null)
        ?.options;
      if (!options?.length) return { ok: true, value };
      const match = options.find(
        (o) => o.toLowerCase() === value.toLowerCase(),
      );
      return match ? { ok: true, value: match } : { ok: false };
    }
    case 'LONG_TEXT':
      return value.length <= 10_000 ? { ok: true, value } : { ok: false };
    default:
      return value.length <= 1_000 ? { ok: true, value } : { ok: false };
  }
}

/**
 * CSV import (Saleshandy-like): the frontend parses the file and maps columns
 * to CustomField keys; rows arrive as `{ [fieldKey]: value }`. Email is
 * required; rows are deduplicated within the file and against the talent's
 * prospects according to `conflictAction`.
 */
@Injectable()
export class ProspectsCsvService {
  private readonly logger = new Logger(ProspectsCsvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: ProspectsIngestionService,
  ) {}

  async import(params: {
    influencerId: string;
    rows: Array<Record<string, string | null | undefined>>;
    conflictAction: ConflictAction;
    tags?: string[];
    userId?: string;
  }): Promise<CsvImportResult> {
    const { influencerId, rows, conflictAction } = params;
    if (rows.length === 0)
      throw new BadRequestException({
        message: 'The file has no rows.',
        code: 'PROSPECT_CSV_EMPTY',
      });
    if (rows.length > CSV_MAX_ROWS) {
      throw new BadRequestException({
        message: `Import up to ${CSV_MAX_ROWS} rows at a time.`,
        code: 'PROSPECT_CSV_ROW_LIMIT_EXCEEDED',
      });
    }

    const fields = await this.prisma.customField.findMany({
      where: { isActive: true },
    });
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const keys = new Set(rows.flatMap((r) => Object.keys(r)));
    if (!keys.has('email')) {
      throw new BadRequestException({
        message: 'Map a column to Email.',
        code: 'PROSPECT_CSV_MISSING_EMAIL_MAPPING',
      });
    }
    const unknown = [...keys].filter(
      (k) => !byKey.has(k) && !columnForFieldKey(k),
    );
    if (unknown.length) {
      throw new BadRequestException({
        message: `Unknown or disabled fields: ${unknown.join(', ')}`,
        code: 'PROSPECT_CSV_UNKNOWN_FIELDS',
      });
    }

    const job = await this.prisma.prospectSyncJob.create({
      data: {
        influencerId,
        type: 'CSV_IMPORT',
        conflictAction,
        totalCount: rows.length,
        initiatedById: params.userId ?? null,
      },
    });

    const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
    const errors: CsvRowError[] = [];
    const fail = (row: number, email: string | null, reason: string) => {
      counts.failed++;
      if (errors.length < MAX_ERRORS_KEPT) errors.push({ row, email, reason });
    };

    // Validate every row first (no DB writes), keep the first occurrence of each email.
    type Prepared = {
      row: number;
      email: string;
      attributes: ProspectAttributes;
      custom: Array<{ fieldId: string; value: string }>;
    };
    const prepared: Prepared[] = [];
    const seen = new Set<string>();
    rows.forEach((raw, index) => {
      const rowNumber = index + 2; // header is row 1
      const email = raw.email?.trim() ?? '';
      if (!email || !isValidEmail(email))
        return fail(rowNumber, email || null, 'INVALID_EMAIL');
      const normalized = normalizeEmail(email);
      if (seen.has(normalized)) {
        counts.skipped++;
        if (errors.length < MAX_ERRORS_KEPT)
          errors.push({ row: rowNumber, email, reason: 'DUPLICATE_IN_FILE' });
        return;
      }
      const attributes: ProspectAttributes = {};
      const custom: Prepared['custom'] = [];
      for (const [key, cell] of Object.entries(raw)) {
        if (
          key === 'email' ||
          cell === null ||
          cell === undefined ||
          !String(cell).trim()
        )
          continue;
        const column = columnForFieldKey(key);
        const field = byKey.get(key);
        if (column && column !== 'email') {
          (attributes as Record<string, string>)[column] = String(cell)
            .trim()
            .slice(0, 1_000);
          continue;
        }
        if (!field) continue;
        const result = normalizeFieldValue(field, String(cell));
        if (!result.ok)
          return fail(rowNumber, email, `INVALID_VALUE:${field.label}`);
        custom.push({ fieldId: field.id, value: result.value });
      }
      const local = normalized.split('@')[0] ?? '';
      const generic = GENERIC_LOCAL_PARTS.has(local.replace(/[^a-z]/g, ''));
      attributes.isGeneric = generic && !attributes.firstName;
      attributes.contactKind =
        attributes.firstName || !generic ? 'PERSON' : 'MAILBOX';
      if (!attributes.companyDomain && attributes.website)
        attributes.companyDomain = domainOf(attributes.website);
      seen.add(normalized);
      prepared.push({ row: rowNumber, email, attributes, custom });
    });

    for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
      const chunk = prepared.slice(i, i + CHUNK_SIZE);
      await this.prisma.$transaction(
        async (tx) => {
          for (const item of chunk) {
            const { prospect, outcome } = await this.ingestion.upsert(
              tx,
              {
                influencerId,
                email: item.email,
                source: 'CSV',
                attributes: item.attributes,
                tags: params.tags,
                createdById: params.userId ?? null,
              },
              conflictAction,
            );
            if (outcome === 'skipped') {
              counts.skipped++;
              continue;
            }
            const wroteCustom = await this.writeCustomValues(
              tx,
              prospect.id,
              item.custom,
              outcome === 'created' ? 'overwrite' : conflictAction,
            );
            if (outcome === 'created') counts.created++;
            else if (outcome === 'updated' || wroteCustom) counts.updated++;
            else counts.skipped++;
          }
        },
        { timeout: 60_000 },
      );
    }

    await this.prisma.prospectSyncJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        createdCount: counts.created,
        updatedCount: counts.updated,
        skippedCount: counts.skipped,
        failedCount: counts.failed,
        errorSummary: errors,
        completedAt: new Date(),
      },
    });
    this.logger.log(
      JSON.stringify({
        event: 'prospects_csv_imported',
        jobId: job.id,
        total: rows.length,
        ...counts,
      }),
    );
    return { jobId: job.id, total: rows.length, ...counts, errors };
  }

  /** Returns true when at least one custom value was written. */
  private async writeCustomValues(
    tx: Prisma.TransactionClient,
    prospectId: string,
    values: Array<{ fieldId: string; value: string }>,
    action: ConflictAction,
  ): Promise<boolean> {
    if (values.length === 0 || action === 'noUpdate') return false;
    let wrote = false;
    for (const { fieldId, value } of values) {
      const key = {
        prospectId_customFieldId: { prospectId, customFieldId: fieldId },
      };
      if (action === 'overwrite') {
        await tx.prospectFieldValue.upsert({
          where: key,
          create: { prospectId, customFieldId: fieldId, value },
          update: { value },
        });
        wrote = true;
      } else {
        const existing = await tx.prospectFieldValue.findUnique({
          where: key,
          select: { id: true },
        });
        if (!existing) {
          await tx.prospectFieldValue.create({
            data: { prospectId, customFieldId: fieldId, value },
          });
          wrote = true;
        }
      }
    }
    return wrote;
  }
}
