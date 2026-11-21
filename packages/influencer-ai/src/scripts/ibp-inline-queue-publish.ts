/**
 * Runs IBP via Mastra and publishes result/events to Redis queues (no Worker).
 * Proves LLM + BullMQ publish path end-to-end.
 */
import { randomUUID } from 'node:crypto';

import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';
import { Queue } from 'bullmq';

import { createIbpAgent } from '../agents/ibp.agent';
import { assertProviderReady, loadInfluencerAiEnv } from '../config/env';
import { AI_EXECUTION_QUEUES } from '../queues';
import { handleAiExecutionRequest } from '../worker/handle-request';
import { createRedisConnection } from '../worker/start-worker';

async function main(): Promise<void> {
  const env = loadInfluencerAiEnv();
  assertProviderReady(env);
  const connection = createRedisConnection(env);
  const resultsQueue = new Queue(AI_EXECUTION_QUEUES.RESULTS, { connection });
  const eventsQueue = new Queue(AI_EXECUTION_QUEUES.EVENTS, { connection });
  const executionId = randomUUID();

  const result = await handleAiExecutionRequest({
    raw: {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId: randomUUID(),
      idempotencyKey: `inline-${executionId}`,
      requestedAt: new Date().toISOString(),
      type: 'IBP_GENERATION',
      context: {
        userId: 'inline',
        influencerId: 'inline-inf',
        resourceId: 'inline-inf',
        resourceType: 'IDEAL_BRAND_PROFILE',
      },
      instructions: { business: 'Produce a concise Ideal Brand Profile as JSON.' },
      input: {
        influencer: {
          id: 'inline-inf',
          name: 'Inline Queue Creator',
          niche: 'food',
          platforms: ['instagram'],
          audienceLocation: 'Spain',
        },
      },
    },
    ibpAgent: createIbpAgent(env),
    env,
    resultsQueue,
    eventsQueue,
  });

  const resultJob = await resultsQueue.getJob(`result-${executionId}`);
  const counts = await resultsQueue.getJobCounts(
    'waiting',
    'completed',
    'failed',
    'active',
  );

  console.log(
    JSON.stringify({
      event: 'ibp_inline_queue_publish',
      status: result.status,
      summary: result.status === 'COMPLETED' ? result.output?.summary : undefined,
      error: result.error?.message,
      executionId,
      resultJobFound: Boolean(resultJob),
      resultJobState: resultJob ? await resultJob.getState() : null,
      counts,
    }),
  );

  await resultsQueue.close();
  await eventsQueue.close();
  if (result.status !== 'COMPLETED' || !resultJob) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
