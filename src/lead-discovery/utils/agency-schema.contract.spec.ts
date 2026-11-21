/**
 * 2C.1 — schema contract tests without DB.
 * Asserts Prisma model shape expectations stay aligned with ai-contracts enums
 * and uniqueness rules documented for Agency / InfluencerAgency.
 */
import {
  agencyRelevanceStatusSchema,
  agencyTypeSchema,
} from '@influence-maven/ai-contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Agency Prisma schema contracts (2C.1)', () => {
  const schemaPath = join(
    __dirname,
    '../../../prisma/schema.prisma',
  );
  const schema = readFileSync(schemaPath, 'utf8');

  it('defines Agency and InfluencerAgency models', () => {
    expect(schema).toMatch(/model Agency \{/);
    expect(schema).toMatch(/model InfluencerAgency \{/);
  });

  it('does not store agencies on BrandCandidate / BrandBusinessContact', () => {
    expect(schema).not.toMatch(/agencyId.*BrandCandidate/);
    expect(schema).toMatch(/model BrandCandidate \{/);
    expect(schema).toMatch(/model BrandBusinessContact \{/);
  });

  it('enforces unique Agency.domain', () => {
    expect(schema).toMatch(/domain\s+String\s+@unique/);
  });

  it('enforces unique influencerId+agencyId association', () => {
    expect(schema).toMatch(
      /@@unique\(\[influencerId,\s*agencyId\]\)/,
    );
  });

  it('links InfluencerAgency to Influencer with cascade', () => {
    expect(schema).toMatch(
      /influencer\s+Influencer\s+@relation\(fields: \[influencerId\].*onDelete: Cascade/,
    );
    expect(schema).toMatch(/influencerAgencies\s+InfluencerAgency\[\]/);
  });

  it('AgencyType enum matches ai-contracts', () => {
    const values = [
      'INFLUENCER_MARKETING_AGENCY',
      'TALENT_REPRESENTATION',
      'MARKETPLACE',
      'GENERAL_MARKETING',
      'DIRECTORY',
      'OTHER',
    ] as const;
    for (const value of values) {
      expect(agencyTypeSchema.parse(value)).toBe(value);
      expect(schema).toContain(value);
    }
  });

  it('AgencyRelevanceStatus enum matches ai-contracts', () => {
    const values = [
      'UNDER_REVIEW',
      'RELEVANT',
      'NOT_RELEVANT',
      'DISCARDED',
    ] as const;
    for (const value of values) {
      expect(agencyRelevanceStatusSchema.parse(value)).toBe(value);
      expect(schema).toContain(value);
    }
  });

  it('migration SQL exists and creates unique indexes', () => {
    const migrationPath = join(
      __dirname,
      '../../../prisma/migrations/20261117120000_add_agency_discovery/migration.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE "Agency"');
    expect(sql).toContain('CREATE TABLE "InfluencerAgency"');
    expect(sql).toContain('CREATE UNIQUE INDEX "Agency_domain_key"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "InfluencerAgency_influencerId_agencyId_key"',
    );
    expect(sql).not.toMatch(/CREATE TABLE "BrandCandidate"/);
    expect(sql).not.toMatch(/REFERENCES "BrandCandidate"/);
    expect(sql).toMatch(/REFERENCES "Agency"/);
    expect(sql).toMatch(/REFERENCES "Influencer"/);
  });
});
