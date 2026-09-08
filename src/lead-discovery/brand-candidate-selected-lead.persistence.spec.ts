import 'dotenv/config';

import { Pool, type QueryResult } from 'pg';
import { randomUUID } from 'crypto';

/**
 * DB-level persistence checks for ADR-0011 (BrandCandidate.selectedLeadId).
 * Uses SQL against DATABASE_URL so we validate FK / ON DELETE SET NULL without
 * depending on Jest resolving the generated Prisma client ESM paths.
 */
describe('BrandCandidate.selectedLeadId persistence (ADR-0011)', () => {
  let pool: Pool;
  const influencerIds: string[] = [];

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is required for persistence tests');
    }
    pool = new Pool({ connectionString: url });
  });

  afterEach(async () => {
    while (influencerIds.length > 0) {
      const id = influencerIds.pop()!;
      await pool.query('DELETE FROM "Influencer" WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedGraph(): Promise<{
    brandId: string;
    leadId: string;
  }> {
    const influencerId = randomUUID();
    const discoveryRunId = randomUUID();
    const brandId = randomUUID();
    const leadRunId = randomUUID();
    const leadId = randomUUID();
    influencerIds.push(influencerId);

    await pool.query(
      `INSERT INTO "Influencer" (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [influencerId, `SelLead ${Date.now()}`],
    );

    await pool.query(
      `INSERT INTO "BrandDiscoveryRun"
         (id, "influencerId", status, source, "limit", "ibpSnapshot", "createdAt", "updatedAt")
       VALUES ($1, $2, 'COMPLETED', 'test', 1, '{}'::jsonb, NOW(), NOW())`,
      [discoveryRunId, influencerId],
    );

    await pool.query(
      `INSERT INTO "BrandCandidate"
         (id, "influencerId", "discoveryRunId", name, website, domain, source,
          "evidenceUrls", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Selection Test Brand', 'https://example.test', $4,
               'test', ARRAY[]::text[], 'APPROVED', NOW(), NOW())`,
      [brandId, influencerId, discoveryRunId, `sel-${Date.now()}.test`],
    );

    await pool.query(
      `INSERT INTO "LeadDiscoveryRun"
         (id, "brandCandidateId", "influencerId", status, "providerId",
          "providerOptions", "limit", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'COMPLETED', 'test', '{}'::jsonb, 1, NOW(), NOW())`,
      [leadRunId, brandId, influencerId],
    );

    await pool.query(
      `INSERT INTO "Lead"
         (id, "brandCandidateId", "influencerId", "runId", "contactName", email,
          "emailConfidence", "isGeneric", "providerId", source, status,
          "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'Test Contact', $5, 'UNKNOWN', false, 'test',
               'test', 'APPROVED', NOW(), NOW())`,
      [
        leadId,
        brandId,
        influencerId,
        leadRunId,
        `sel-${Date.now()}@example.com`,
      ],
    );

    return { brandId, leadId };
  }

  it('allows BrandCandidate with selectedLeadId = null', async () => {
    const { brandId } = await seedGraph();
    const res: QueryResult<{ selectedLeadId: string | null }> =
      await pool.query(
        `SELECT "selectedLeadId" FROM "BrandCandidate" WHERE id = $1`,
        [brandId],
      );
    expect(res.rows[0]?.selectedLeadId).toBeNull();
  });

  it('can reference a valid Lead and read it back', async () => {
    const { brandId, leadId } = await seedGraph();

    await pool.query(
      `UPDATE "BrandCandidate" SET "selectedLeadId" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [leadId, brandId],
    );

    const res = await pool.query<{
      selectedLeadId: string;
      lead_email: string;
    }>(
      `SELECT b."selectedLeadId", l.email AS lead_email
       FROM "BrandCandidate" b
       JOIN "Lead" l ON l.id = b."selectedLeadId"
       WHERE b.id = $1`,
      [brandId],
    );

    expect(res.rows[0]?.selectedLeadId).toBe(leadId);
    expect(res.rows[0]?.lead_email).toContain('@example.com');
  });

  it('rejects a non-existent Lead id (foreign key)', async () => {
    const { brandId } = await seedGraph();
    const fakeLeadId = '00000000-0000-4000-8000-000000000099';

    await expect(
      pool.query(
        `UPDATE "BrandCandidate" SET "selectedLeadId" = $1 WHERE id = $2`,
        [fakeLeadId, brandId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('sets selectedLeadId to null when the selected Lead is deleted', async () => {
    const { brandId, leadId } = await seedGraph();

    await pool.query(
      `UPDATE "BrandCandidate" SET "selectedLeadId" = $1 WHERE id = $2`,
      [leadId, brandId],
    );

    await pool.query(`DELETE FROM "Lead" WHERE id = $1`, [leadId]);

    const brand = await pool.query<{
      selectedLeadId: string | null;
      id: string;
    }>(`SELECT id, "selectedLeadId" FROM "BrandCandidate" WHERE id = $1`, [
      brandId,
    ]);

    expect(brand.rows[0]?.id).toBe(brandId);
    expect(brand.rows[0]?.selectedLeadId).toBeNull();
  });
});
