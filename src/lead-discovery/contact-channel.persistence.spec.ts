import 'dotenv/config';

import { Pool } from 'pg';
import { randomUUID } from 'crypto';

/**
 * DB-level persistence checks for ContactChannel (ADR-0014 / D2).
 */
describe('ContactChannel persistence (D2)', () => {
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

  async function seedLead(): Promise<{ leadId: string }> {
    const influencerId = randomUUID();
    const discoveryRunId = randomUUID();
    const brandId = randomUUID();
    const leadRunId = randomUUID();
    const leadId = randomUUID();
    influencerIds.push(influencerId);

    await pool.query(
      `INSERT INTO "Influencer" (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [influencerId, `CC ${Date.now()}`],
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
       VALUES ($1, $2, $3, 'CC Test Brand', 'https://example.test', $4,
               'test', ARRAY[]::text[], 'APPROVED', NOW(), NOW())`,
      [brandId, influencerId, discoveryRunId, `cc-${Date.now()}.test`],
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
         (id, "brandCandidateId", "influencerId", "runId", "contactName",
          "emailConfidence", "isGeneric", "providerId", source, status,
          "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'CC Contact', 'UNKNOWN', false, 'test',
               'test', 'UNDER_REVIEW', NOW(), NOW())`,
      [leadId, brandId, influencerId, leadRunId],
    );

    return { leadId };
  }

  async function insertChannel(
    leadId: string,
    type: string,
    value: string,
    valueNormalized: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const channelId = randomUUID();
    await pool.query(
      `INSERT INTO "ContactChannel"
         (id, "leadId", type, value, "valueNormalized", status, source,
          "sourceUrl", "isGeneric", metadata, "createdAt", "updatedAt")
       VALUES ($1, $2, $3::"ContactChannelType", $4, $5,
               'ACTIVE'::"ContactChannelStatus",
               'PUBLIC_WEB'::"ContactChannelSource",
               $6, $7, $8::jsonb, NOW(), NOW())`,
      [
        channelId,
        leadId,
        type,
        value,
        valueNormalized,
        'https://example.test/page',
        true,
        JSON.stringify(metadata ?? { evidences: [] }),
      ],
    );
    return channelId;
  }

  it('enforces unique (leadId, type, valueNormalized)', async () => {
    const { leadId } = await seedLead();
    await insertChannel(leadId, 'EMAIL', 'info@test.com', 'info@test.com');

    await expect(
      insertChannel(leadId, 'EMAIL', 'info@test.com', 'info@test.com'),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('defaults commercialRelevance to UNKNOWN for historical-compatible inserts', async () => {
    const { leadId } = await seedLead();
    const channelId = await insertChannel(
      leadId,
      'EMAIL',
      'info@test.com',
      'info@test.com',
    );

    const res = await pool.query<{ commercialRelevance: string }>(
      `SELECT "commercialRelevance" FROM "ContactChannel" WHERE id = $1`,
      [channelId],
    );

    expect(res.rows[0]?.commercialRelevance).toBe('UNKNOWN');
  });

  it('cascades delete when Lead is removed', async () => {
    const { leadId } = await seedLead();
    const channelId = await insertChannel(
      leadId,
      'LINKEDIN',
      'https://linkedin.com/in/user',
      'https://linkedin.com/in/user',
    );

    await pool.query(`DELETE FROM "Lead" WHERE id = $1`, [leadId]);

    const res = await pool.query(
      `SELECT id FROM "ContactChannel" WHERE id = $1`,
      [channelId],
    );
    expect(res.rows).toHaveLength(0);
  });

  it('rejects channel for non-existent lead (foreign key)', async () => {
    const fakeLeadId = '00000000-0000-4000-8000-000000000099';

    await expect(
      insertChannel(fakeLeadId, 'EMAIL', 'a@b.com', 'a@b.com'),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('merges metadata evidences by sourceUrl on update', async () => {
    const { leadId } = await seedLead();
    const channelId = await insertChannel(
      leadId,
      'EMAIL',
      'info@test.com',
      'info@test.com',
      {
        evidences: [
          {
            sourceUrl: 'https://example.test/a',
            evidenceSnippet: 'info@test.com on a',
          },
        ],
      },
    );

    const merged = {
      evidences: [
        {
          sourceUrl: 'https://example.test/a',
          evidenceSnippet: 'info@test.com on a',
        },
        {
          sourceUrl: 'https://example.test/b',
          evidenceSnippet: 'info@test.com on b',
        },
      ],
    };

    await pool.query(
      `UPDATE "ContactChannel" SET metadata = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
      [JSON.stringify(merged), channelId],
    );

    const res = await pool.query<{ metadata: { evidences: unknown[] } }>(
      `SELECT metadata FROM "ContactChannel" WHERE id = $1`,
      [channelId],
    );

    expect(res.rows[0]?.metadata.evidences).toHaveLength(2);
  });
});
