import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const influencers = await c.query(`
  SELECT i.id, i.name, i.niche, ibp.status::text AS ibp_status
  FROM "Influencer" i
  JOIN "IdealBrandProfile" ibp ON ibp."influencerId" = i.id
  WHERE ibp.status = 'ACTIVE'
  ORDER BY i."updatedAt" DESC NULLS LAST
  LIMIT 5
`);
console.log('active_ibp', JSON.stringify(influencers.rows));

const users = await c.query(`
  SELECT id, email, role::text AS role
  FROM "User"
  ORDER BY "createdAt" ASC
  LIMIT 5
`);
console.log(
  'users',
  JSON.stringify(users.rows.map((u) => ({ id: u.id, email: u.email, role: u.role }))),
);

await c.end();
