/**
 * Controlled AI-003.2 validation: enqueue domain IBP job and assert Mastra path persistence.
 * Requires: Nest (IBP → AiExecutionPublisher) + consumers, influencer-ai worker, Ollama, Redis, Postgres.
 */
import 'dotenv/config';
import pg from 'pg';
import { Queue } from 'bullmq';

const { Client } = pg;

const INFLUENCER_ID =
  process.env.VALIDATE_IBP_INFLUENCER_ID ||
  'af3d5690-5dd0-4c34-951c-f6b81e6383eb'; // Solusat

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB || 0),
};

function counts(q) {
  return q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const domain = new Queue('ai', { connection });
  const requests = new Queue('ai.execution.requests', { connection });
  const results = new Queue('ai.execution.results', { connection });
  const events = new Queue('ai.execution.events', { connection });

  console.log('=== queue counts BEFORE ===');
  console.log({
    requests: await counts(requests),
    results: await counts(results),
    events: await counts(events),
    domain: await counts(domain),
  });

  const beforeRes = await client.query(
    `SELECT id, status, summary, metadata FROM "IdealBrandProfile" WHERE "influencerId" = $1`,
    [INFLUENCER_ID],
  );
  if (!beforeRes.rows[0]) throw new Error(`No IBP for influencer ${INFLUENCER_ID}`);

  await client.query(
    `UPDATE "IdealBrandProfile" SET status = 'PROCESSING', "updatedAt" = NOW() WHERE "influencerId" = $1`,
    [INFLUENCER_ID],
  );

  const job = await domain.add(
    'generate-ideal-brand-profile',
    {
      influencerId: INFLUENCER_ID,
      promptInstructions: undefined,
      requestedByUserId: 'validate:ai-0032',
    },
    { removeOnComplete: 50, removeOnFail: 50 },
  );
  console.log('enqueued domain job', job.id);

  const deadline = Date.now() + 180_000;
  let row = beforeRes.rows[0];
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const cur = await client.query(
      `SELECT status, summary, metadata FROM "IdealBrandProfile" WHERE "influencerId" = $1`,
      [INFLUENCER_ID],
    );
    row = cur.rows[0];
    const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const executionId = meta?.aiExecution?.executionId;
    console.log(
      `poll status=${row?.status} hasAiExecution=${Boolean(executionId)} llmCallCount=${meta?.llmCallCount ?? null}`,
    );
    if (
      row &&
      (row.status === 'DRAFT' || row.status === 'FAILED') &&
      executionId
    ) {
      break;
    }
    if (row?.status === 'DRAFT' && !executionId) {
      console.error('DRAFT without aiExecution — still on AiService path');
      break;
    }
  }

  console.log('=== queue counts AFTER ===');
  console.log({
    requests: await counts(requests),
    results: await counts(results),
    events: await counts(events),
    domain: await counts(domain),
  });

  const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const ok =
    row?.status === 'DRAFT' &&
    Boolean(meta?.aiExecution?.executionId) &&
    typeof meta?.llmCallCount === 'number';

  console.log('=== RESULT ===');
  console.log(
    JSON.stringify(
      {
        ok,
        influencerId: INFLUENCER_ID,
        status: row?.status,
        summary: (row?.summary || '').slice(0, 120),
        executionId: meta?.aiExecution?.executionId ?? null,
        provider: meta?.provider ?? null,
        model: meta?.model ?? null,
        llmCallCount: meta?.llmCallCount ?? null,
        aiExecution: meta?.aiExecution ?? null,
      },
      null,
      2,
    ),
  );

  await domain.close();
  await requests.close();
  await results.close();
  await events.close();
  await client.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
