import 'dotenv/config';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import pg from 'pg';

const redis = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB || 0),
  maxRetriesPerRequest: null,
});

async function dumpJobs(q, states, limit = 30) {
  const jobs = await q.getJobs(states, 0, limit);
  const out = [];
  for (const j of jobs) {
    out.push({
      id: j.id,
      name: j.name,
      state: await j.getState(),
      timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
      finishedOn: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
      processedOn: j.processedOn ? new Date(j.processedOn).toISOString() : null,
      attemptsMade: j.attemptsMade,
      failedReason: j.failedReason || null,
      type: j.data?.type,
      executionId: j.data?.executionId || j.data?.influencerId || null,
      influencerId:
        j.data?.context?.influencerId ||
        j.data?.influencerId ||
        j.data?.input?.influencer?.id ||
        null,
      status: j.data?.status,
      provider:
        j.data?.metadata?.provider || j.data?.configuration?.provider || null,
      model: j.data?.metadata?.model || j.data?.configuration?.model || null,
      summary: j.data?.output?.summary?.slice?.(0, 100) || null,
      transportHint: j.data?.aiExecution || null,
    });
  }
  return out;
}

const requestsQ = new Queue('ai.execution.requests', {
  connection: redis.duplicate(),
});
const resultsQ = new Queue('ai.execution.results', {
  connection: redis.duplicate(),
});
const eventsQ = new Queue('ai.execution.events', {
  connection: redis.duplicate(),
});
const domainAiQ = new Queue('ai', { connection: redis.duplicate() });

console.log('=== requests completed+failed ===');
console.log(
  JSON.stringify(
    await dumpJobs(requestsQ, ['completed', 'failed'], 20),
    null,
    2,
  ),
);

console.log('=== results waiting+completed+failed ===');
console.log(
  JSON.stringify(
    await dumpJobs(resultsQ, ['waiting', 'completed', 'failed'], 30),
    null,
    2,
  ),
);

console.log('=== domain ai completed (IBP jobs) ===');
const domain = await dumpJobs(domainAiQ, ['completed', 'failed'], 20);
console.log(
  JSON.stringify(
    domain.filter(
      (j) =>
        j.name === 'generate-ideal-brand-profile' ||
        j.id?.includes?.('ibp') ||
        true,
    ),
    null,
    2,
  ),
);

// Cross-check: for each waiting result, compare summary with DB profiles
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const db = await client.query(`
  SELECT id, "influencerId", status, summary, "updatedAt", metadata
  FROM "IdealBrandProfile"
  ORDER BY "updatedAt" DESC
  LIMIT 5
`);

const waitingResults = await dumpJobs(resultsQ, ['waiting'], 20);
console.log('=== CROSS: DB vs waiting results by summary/provider ===');
for (const row of db.rows) {
  const m = row.metadata || {};
  const match = waitingResults.find(
    (r) =>
      r.summary &&
      row.summary &&
      (row.summary.startsWith(r.summary.slice(0, 40)) ||
        r.summary.startsWith(String(row.summary).slice(0, 40))),
  );
  console.log(
    JSON.stringify({
      influencerId: row.influencerId,
      status: row.status,
      updatedAt: row.updatedAt,
      dbProvider: m.provider,
      dbHasAiExecution: Boolean(m.aiExecution),
      dbSummary: String(row.summary || '').slice(0, 80),
      matchedWaitingResultExecutionId: match?.executionId || null,
      matchedWaitingResultSummary: match?.summary || null,
    }),
  );
}

// Full metadata dump for top 2
console.log('=== FULL metadata top 2 ===');
for (const row of db.rows.slice(0, 2)) {
  console.log(
    JSON.stringify(
      {
        influencerId: row.influencerId,
        status: row.status,
        updatedAt: row.updatedAt,
        metadata: row.metadata,
        summary: row.summary,
      },
      null,
      2,
    ),
  );
}

await client.end();
await requestsQ.close();
await resultsQ.close();
await eventsQ.close();
await domainAiQ.close();
await redis.quit();
