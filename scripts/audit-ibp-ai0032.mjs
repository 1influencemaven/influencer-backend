import 'dotenv/config';
import pg from 'pg';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';

const { Client } = pg;

function redactEnvLine(line) {
  if (/KEY|SECRET|PASSWORD|DATABASE_URL/i.test(line)) {
    return line.replace(/(=).+/, '$1***');
  }
  return line;
}

async function main() {
  console.log('=== ENV (selected) ===');
  for (const k of [
    'AI_PROVIDER',
    'OLLAMA_MODEL',
    'OLLAMA_BASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_DB',
  ]) {
    console.log(`${k}=${process.env[k] ?? ''}`);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const profiles = await client.query(`
    SELECT id, "influencerId", status, summary, "updatedAt", "createdAt", metadata
    FROM "IdealBrandProfile"
    ORDER BY "updatedAt" DESC
    LIMIT 10
  `);

  console.log('=== IdealBrandProfile latest ===');
  const rows = profiles.rows.map((row) => {
    const m = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return {
      id: row.id,
      influencerId: row.influencerId,
      status: row.status,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      summary: String(row.summary || '').slice(0, 160),
      provider: m.provider ?? null,
      model: m.model ?? null,
      promptVersion: m.promptVersion ?? null,
      llmCallCount: m.llmCallCount ?? null,
      lastGeneratedAt: m.lastGeneratedAt ?? null,
      aiExecution: m.aiExecution ?? null,
      metadataKeys: Object.keys(m),
    };
  });
  console.log(JSON.stringify(rows, null, 2));

  const withExec = rows.filter((r) => r.aiExecution?.executionId);
  const candidates = withExec.slice(0, 5);
  console.log('=== candidates with aiExecution.executionId ===');
  console.log(JSON.stringify(candidates, null, 2));

  const redis = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    maxRetriesPerRequest: null,
  });

  const requestsQ = new Queue('ai.execution.requests', { connection: redis.duplicate() });
  const resultsQ = new Queue('ai.execution.results', { connection: redis.duplicate() });
  const eventsQ = new Queue('ai.execution.events', { connection: redis.duplicate() });
  const domainAiQ = new Queue('ai', { connection: redis.duplicate() });

  console.log('=== queue job counts ===');
  for (const [name, q] of [
    ['requests', requestsQ],
    ['results', resultsQ],
    ['events', eventsQ],
    ['domain-ai', domainAiQ],
  ]) {
    const counts = await q.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    );
    console.log(name, counts);
  }

  // Inspect jobs for each candidate executionId
  for (const c of candidates.slice(0, 4)) {
    const executionId = c.aiExecution.executionId;
    console.log(`\n=== JOBS for executionId=${executionId} ===`);
    const reqJob = await requestsQ.getJob(executionId);
    const resJob = await resultsQ.getJob(`result-${executionId}`);
    console.log(
      JSON.stringify(
        {
          requestJob: reqJob
            ? {
                id: reqJob.id,
                name: reqJob.name,
                state: await reqJob.getState(),
                attemptsMade: reqJob.attemptsMade,
                failedReason: reqJob.failedReason,
                timestamp: reqJob.timestamp,
                finishedOn: reqJob.finishedOn,
                processedOn: reqJob.processedOn,
                dataType: reqJob.data?.type,
                dataExecutionId: reqJob.data?.executionId,
                dataProvider: reqJob.data?.configuration?.provider,
                dataModel: reqJob.data?.configuration?.model,
              }
            : null,
          resultJob: resJob
            ? {
                id: resJob.id,
                name: resJob.name,
                state: await resJob.getState(),
                attemptsMade: resJob.attemptsMade,
                failedReason: resJob.failedReason,
                timestamp: resJob.timestamp,
                finishedOn: resJob.finishedOn,
                processedOn: resJob.processedOn,
                status: resJob.data?.status,
                type: resJob.data?.type,
                provider: resJob.data?.metadata?.provider,
                model: resJob.data?.metadata?.model,
                llmCallCount: resJob.data?.metadata?.llmCallCount,
                durationMs: resJob.data?.durationMs,
                summary: resJob.data?.output?.summary?.slice?.(0, 160),
                error: resJob.data?.error ?? null,
              }
            : null,
        },
        null,
        2,
      ),
    );

    // Scan recent events for this executionId (events use event-{uuid})
    const eventJobs = await eventsQ.getJobs(
      ['completed', 'waiting', 'failed', 'active'],
      0,
      200,
    );
    const relatedEvents = [];
    for (const j of eventJobs) {
      if (j?.data?.executionId === executionId) {
        relatedEvents.push({
          id: j.id,
          state: await j.getState(),
          name: j.data?.name,
          sequence: j.data?.sequence,
          payloadKind: j.data?.payload?.kind,
          occurredAt: j.data?.occurredAt,
        });
      }
    }
    relatedEvents.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    console.log('events', JSON.stringify(relatedEvents, null, 2));
  }

  // Recent failed jobs
  console.log('\n=== recent failed request jobs ===');
  const failedReq = await requestsQ.getJobs(['failed'], 0, 10);
  for (const j of failedReq) {
    console.log(
      JSON.stringify({
        id: j.id,
        failedReason: j.failedReason,
        attemptsMade: j.attemptsMade,
        type: j.data?.type,
        executionId: j.data?.executionId,
      }),
    );
  }

  await requestsQ.close();
  await resultsQ.close();
  await eventsQ.close();
  await domainAiQ.close();
  await redis.quit();
  await client.end();
}

main().catch((e) => {
  console.error('AUDIT_ERROR', e);
  process.exit(1);
});
