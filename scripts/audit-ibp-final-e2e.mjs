import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import { Queue } from 'bullmq';

const { Client } = pg;
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB || 0),
};

async function jobSnapshot(queue, states) {
  const out = [];
  for (const state of states) {
    const jobs = await queue.getJobs([state], 0, 30);
    for (const j of jobs) {
      const d = j.data || {};
      out.push({
        queue: queue.name,
        state,
        id: j.id,
        name: j.name,
        timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
        processedOn: j.processedOn ? new Date(j.processedOn).toISOString() : null,
        finishedOn: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason || null,
        executionId: d.executionId || null,
        type: d.type || null,
        influencerId: d.context?.influencerId || d.influencerId || null,
        requestedByUserId: d.context?.requestedByUserId || d.requestedByUserId || null,
        status: d.status || null,
        provider: d.metadata?.provider || d.configuration?.provider || null,
        model: d.metadata?.model || d.configuration?.model || null,
        llmCallCount: d.metadata?.llmCallCount ?? null,
        summary: d.output?.summary
          ? String(d.output.summary).slice(0, 100)
          : null,
      });
    }
  }
  return out;
}

async function main() {
  process.chdir(
    'C:/Users/luigi/Documents/projects/app-influencers/influencer-backend',
  );
  await import('dotenv/config');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const r = await client.query(`
    SELECT ibp.id, ibp."influencerId", ibp.status, ibp.summary, ibp.metadata,
           ibp."targetSectors", ibp."excludedSectors", ibp."brandSize", ibp.markets,
           ibp."collaborationTypes", ibp."alertSignals", ibp."desirableCriteria",
           ibp."createdAt", ibp."updatedAt",
           i.name
    FROM "IdealBrandProfile" ibp
    JOIN "Influencer" i ON i.id = ibp."influencerId"
    ORDER BY ibp."updatedAt" DESC
    LIMIT 8
  `);

  console.log('=== LATEST IBP ROWS ===');
  for (const row of r.rows) {
    const m = row.metadata || {};
    console.log(
      JSON.stringify(
        {
          ibpId: row.id,
          influencerId: row.influencerId,
          displayName: row.name,
          status: row.status,
          updatedAt: row.updatedAt,
          lastGeneratedAt: m.lastGeneratedAt || null,
          provider: m.provider || null,
          model: m.model || null,
          llmCallCount: m.llmCallCount ?? null,
          executionId: m.aiExecution?.executionId || null,
          correlationId: m.aiExecution?.correlationId || null,
          aiStatus: m.aiExecution?.status || null,
          durationMs: m.aiExecution?.durationMs ?? null,
          transport: m.aiExecution?.transport || null,
          summary: (row.summary || '').slice(0, 160),
          arrayLens: {
            targetSectors: (row.targetSectors || []).length,
            excludedSectors: (row.excludedSectors || []).length,
            brandSize: (row.brandSize || []).length,
            markets: (row.markets || []).length,
            collaborationTypes: (row.collaborationTypes || []).length,
            alertSignals: (row.alertSignals || []).length,
            desirableCriteria: (row.desirableCriteria || []).length,
          },
          metaKeys: Object.keys(m),
          fullAiExecution: m.aiExecution || null,
        },
        null,
        2,
      ),
    );
  }

  // candidates with executionId after fix window (today)
  const withExec = r.rows.filter(
    (row) => row.metadata?.aiExecution?.executionId,
  );
  console.log(
    '=== WITH aiExecution (from top8) ===',
    withExec.map((x) => ({
      name: x.name,
      executionId: x.metadata.aiExecution.executionId,
      updatedAt: x.updatedAt,
    })),
  );

  const requests = new Queue('ai.execution.requests', { connection });
  const results = new Queue('ai.execution.results', { connection });
  const events = new Queue('ai.execution.events', { connection });
  const domain = new Queue('ai', { connection });

  console.log('=== QUEUE COUNTS ===');
  for (const [name, q] of [
    ['requests', requests],
    ['results', results],
    ['events', events],
    ['domain-ai', domain],
  ]) {
    console.log(
      name,
      await q.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
      ),
    );
  }

  const target =
    withExec[0]?.metadata?.aiExecution?.executionId ||
    process.env.AUDIT_EXECUTION_ID;
  console.log('=== TARGET executionId ===', target);

  if (target) {
    const allJobs = [
      ...(await jobSnapshot(requests, ['completed', 'failed', 'waiting', 'active'])),
      ...(await jobSnapshot(results, ['completed', 'failed', 'waiting', 'active'])),
      ...(await jobSnapshot(events, ['completed', 'failed', 'waiting', 'active'])),
      ...(await jobSnapshot(domain, ['completed', 'failed', 'waiting', 'active'])),
    ].filter(
      (j) =>
        j.executionId === target ||
        j.id === target ||
        j.id === `result-${target}` ||
        String(j.id || '').includes(target),
    );
    console.log('=== JOBS FOR TARGET ===');
    console.log(JSON.stringify(allJobs, null, 2));

    // domain jobs for that influencer
    const infId = withExec[0]?.influencerId;
    const domainJobs = await jobSnapshot(domain, ['completed', 'failed']);
    console.log(
      '=== DOMAIN IBP JOBS for influencer ===',
      JSON.stringify(
        domainJobs.filter(
          (j) =>
            j.name === 'generate-ideal-brand-profile' &&
            (j.influencerId === infId ||
              j.executionId === infId ||
              (j.timestamp &&
                withExec[0] &&
                Math.abs(
                  new Date(j.finishedOn || j.timestamp) -
                    new Date(withExec[0].updatedAt),
                ) < 120000)),
        ),
        null,
        2,
      ),
    );
  }

  // recent requests with requestedByUserId
  const recentReq = await jobSnapshot(requests, ['completed', 'failed']);
  console.log('=== RECENT REQUESTS (top) ===');
  console.log(
    JSON.stringify(
      recentReq
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        .slice(0, 8),
      null,
      2,
    ),
  );

  const recentRes = await jobSnapshot(results, ['completed', 'waiting', 'failed']);
  console.log('=== RECENT RESULTS (top) ===');
  console.log(
    JSON.stringify(
      recentRes
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        .slice(0, 8),
      null,
      2,
    ),
  );

  // duplicate check
  for (const row of withExec.slice(0, 3)) {
    const dup = await client.query(
      `SELECT count(*)::int AS c FROM "IdealBrandProfile" WHERE "influencerId" = $1`,
      [row.influencerId],
    );
    console.log('dupCount', row.influencerId, dup.rows[0].c);
  }

  // PROCESSING stuck
  const proc = await client.query(
    `SELECT id, "influencerId", status, metadata, "updatedAt" FROM "IdealBrandProfile" WHERE status = 'PROCESSING'`,
  );
  console.log('=== PROCESSING STUCK ===', JSON.stringify(proc.rows, null, 2));

  await requests.close();
  await results.close();
  await events.close();
  await domain.close();
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
