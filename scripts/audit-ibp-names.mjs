import 'dotenv/config';
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  `SELECT id, name FROM "Influencer" WHERE id = ANY($1::text[])`,
  [
    [
      'af3d5690-5dd0-4c34-951c-f6b81e6383eb',
      '59a25b1d-4fb5-4193-9c46-0bee4770689c',
    ],
  ],
);
console.log(JSON.stringify(r.rows, null, 2));
await c.end();
