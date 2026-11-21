import 'dotenv/config';

import { Pool } from 'pg';
import { randomUUID } from 'crypto';

/**
 * DB-level persistence checks for BrandBusinessContact (ADR-0016 / Phase 0).
 */
describe('BrandBusinessContact persistence (Phase 0)', () => {
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

  async function seedBrand(): Promise<{ brandId: string }> {
    const influencerId = randomUUID();
    const discoveryRunId = randomUUID();
    const brandId = randomUUID();
    influencerIds.push(influencerId);

    await pool.query(
      `INSERT INTO "Influencer" (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [influencerId, `BBC ${Date.now()}`],
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
       VALUES ($1, $2, $3, 'BBC Test Brand', 'https://example.test', $4,
               'test', ARRAY[]::text[], 'APPROVED', NOW(), NOW())`,
      [brandId, influencerId, discoveryRunId, `bbc-${Date.now()}.test`],
    );

    return { brandId };
  }

  async function insertBusinessContact(
    brandCandidateId: string,
    email: string,
    emailNormalized: string,
    opts?: { label?: string; commercialRelevance?: string },
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO "BrandBusinessContact"
         (id, "brandCandidateId", email, "emailNormalized", label,
          "isGeneric", "commercialRelevance", source, "sourceUrl",
          metadata, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, true,
               $6::"CommercialRelevance",
               'PUBLIC_WEB'::"ContactChannelSource",
               $7, '{}'::jsonb, NOW(), NOW())`,
      [
        id,
        brandCandidateId,
        email,
        emailNormalized,
        opts?.label ?? null,
        opts?.commercialRelevance ?? 'UNKNOWN',
        'https://example.test/partnerships',
      ],
    );
    return id;
  }

  it('associates BrandBusinessContact with BrandCandidate', async () => {
    const { brandId } = await seedBrand();
    const id = await insertBusinessContact(
      brandId,
      'partnerships@example.test',
      'partnerships@example.test',
      { label: 'Partnerships', commercialRelevance: 'HIGH' },
    );

    const res = await pool.query(
      `SELECT id, "brandCandidateId", email, label, "commercialRelevance", "isGeneric"
       FROM "BrandBusinessContact" WHERE id = $1`,
      [id],
    );

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      brandCandidateId: brandId,
      email: 'partnerships@example.test',
      label: 'Partnerships',
      commercialRelevance: 'HIGH',
      isGeneric: true,
    });
  });

  it('requires emailNormalized (NOT NULL)', async () => {
    const { brandId } = await seedBrand();
    const id = randomUUID();

    await expect(
      pool.query(
        `INSERT INTO "BrandBusinessContact"
           (id, "brandCandidateId", email, "emailNormalized",
            "isGeneric", "commercialRelevance", source, "createdAt", "updatedAt")
         VALUES ($1, $2, 'a@b.com', NULL,
                 true, 'UNKNOWN'::"CommercialRelevance",
                 'MANUAL'::"ContactChannelSource", NOW(), NOW())`,
        [id, brandId],
      ),
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('rejects duplicate emailNormalized for the same BrandCandidate', async () => {
    const { brandId } = await seedBrand();
    await insertBusinessContact(
      brandId,
      'partnerships@brand.com',
      'partnerships@brand.com',
    );

    await expect(
      insertBusinessContact(
        brandId,
        'PARTNERSHIPS@brand.com',
        'partnerships@brand.com',
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('allows the same emailNormalized on different BrandCandidates', async () => {
    const a = await seedBrand();
    const b = await seedBrand();

    await insertBusinessContact(
      a.brandId,
      'partnerships@brand.com',
      'partnerships@brand.com',
    );
    const idB = await insertBusinessContact(
      b.brandId,
      'partnerships@brand.com',
      'partnerships@brand.com',
    );

    const res = await pool.query(
      `SELECT id FROM "BrandBusinessContact" WHERE id = $1`,
      [idB],
    );
    expect(res.rows).toHaveLength(1);
  });

  it('cascades delete when BrandCandidate is removed', async () => {
    const { brandId } = await seedBrand();
    const id = await insertBusinessContact(
      brandId,
      'collab@example.test',
      'collab@example.test',
    );

    await pool.query(`DELETE FROM "BrandCandidate" WHERE id = $1`, [brandId]);

    const res = await pool.query(
      `SELECT id FROM "BrandBusinessContact" WHERE id = $1`,
      [id],
    );
    expect(res.rows).toHaveLength(0);
  });
});
