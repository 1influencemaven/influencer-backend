/**
 * Publishes one IBP request to BullMQ and waits until influencer-ai writes a result job.
 * Requires Redis + worker (`npm run start:influencer-ai` / `node dist/main.js`).
 */
import { randomUUID } from 'node:crypto';

import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';
import { Queue } from 'bullmq';

import { loadInfluencerAiEnv } from '../config/env';
import { AI_EXECUTION_JOBS, AI_EXECUTION_QUEUES } from '../queues';
import { createRedisConnection } from '../worker/start-worker';

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const env = loadInfluencerAiEnv();
  const connection = createRedisConnection(env);
  const requests = new Queue(AI_EXECUTION_QUEUES.REQUESTS, { connection });
  const results = new Queue(AI_EXECUTION_QUEUES.RESULTS, { connection });

  const executionId = randomUUID();
  const correlationId = randomUUID();

  await requests.add(
    AI_EXECUTION_JOBS.EXECUTE,
    {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `roundtrip:${executionId}`,
      requestedAt: new Date().toISOString(),
      type: 'IBP_GENERATION',
      context: {
        userId: 'roundtrip',
        influencerId: 'roundtrip-inf',
        resourceId: 'roundtrip-inf',
        resourceType: 'IDEAL_BRAND_PROFILE',
      },
      instructions: { business: 'Produce a concise IBP JSON object.' },
      configuration: {
        provider: env.aiProvider,
        model:
          env.aiProvider === 'anthropic' ? env.anthropicModel : env.ollamaModel,
      },
      input: {
        influencer: {
          id: 'roundtrip-inf',
          name: 'Queue Roundtrip Creator',
          niche: 'beauty',
          platforms: ['instagram'],
          audienceLocation: 'Spain',
        },
      },
    },
    { jobId: executionId },
  );

  console.log(
    JSON.stringify({
      event: 'ibp_queue_request_published',
      executionId,
      queue: AI_EXECUTION_QUEUES.REQUESTS,
    }),
  );

  const deadline = Date.now() + 180_000;
  let found = false;
  while (Date.now() < deadline) {
    const job = await results.getJob(`result-${executionId}`);
    if (job) {
      const state = await job.getState();
      console.log(
        JSON.stringify({
          event: 'ibp_queue_result_observed',
          executionId,
          state,
          status: (job.data as { status?: string })?.status,
          summary: (job.data as { output?: { summary?: string } })?.output
            ?.summary,
        }),
      );
      found = true;
      break;
    }
    await sleep(1500);
  }

  await requests.close();
  await results.close();
  if (!found) {
    throw new Error('Timeout waiting for ai.execution.results job');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
