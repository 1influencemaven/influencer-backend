import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const r = await c.query(`
  SELECT i.id, i.name, i.niche, ibp.id AS ibp_id, ibp.status::text AS ibp_status,
         cardinality(ibp."targetSectors") AS sectors,
         cardinality(ibp.markets) AS markets
  FROM "Influencer" i
  LEFT JOIN "IdealBrandProfile" ibp ON ibp."influencerId" = i.id
  ORDER BY i."createdAt" DESC
  LIMIT 15
`);
console.log(JSON.stringify(r.rows, null, 2));
await c.end();
