import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';
import { Worker, Queue, type ConnectionOptions } from 'bullmq';

import { createBrandDiscoveryAgent } from '../agents/brand-discovery.agent';
import { createIbpAgent } from '../agents/ibp.agent';
import {
  assertProviderReady,
  loadInfluencerAiEnv,
  type InfluencerAiEnv,
} from '../config/env';
import { AI_EXECUTION_QUEUES } from '../queues';
import { assertBrandDiscoveryContractsReady } from './assert-brand-discovery-contracts';
import { handleAiExecutionRequest } from './handle-request';

export { assertBrandDiscoveryContractsReady } from './assert-brand-discovery-contracts';

export type StartedWorker = {
  env: InfluencerAiEnv;
  requestWorker: Worker;
  resultsQueue: Queue;
  eventsQueue: Queue;
  close: () => Promise<void>;
};

export function createRedisConnection(
  env: InfluencerAiEnv,
): ConnectionOptions {
  return {
    host: env.redisHost,
    port: env.redisPort,
    password: env.redisPassword,
    db: env.redisDb,
    maxRetriesPerRequest: null,
  };
}

export async function startInfluencerAiWorker(): Promise<StartedWorker> {
  const env = loadInfluencerAiEnv();
  assertProviderReady(env);
  assertBrandDiscoveryContractsReady();
  const connection = createRedisConnection(env);

  const resultsQueue = new Queue(AI_EXECUTION_QUEUES.RESULTS, { connection });
  const eventsQueue = new Queue(AI_EXECUTION_QUEUES.EVENTS, { connection });
  const ibpAgent = createIbpAgent(env);
  const brandDiscoveryAgent = createBrandDiscoveryAgent(env);

  const requestWorker = new Worker(
    AI_EXECUTION_QUEUES.REQUESTS,
    async (job) => {
      await handleAiExecutionRequest({
        raw: job.data,
        ibpAgent,
        brandDiscoveryAgent,
        env,
        resultsQueue,
        eventsQueue,
      });
    },
    {
      connection,
      concurrency: 2,
    },
  );

  requestWorker.on('failed', (job, err) => {
    console.error(
      JSON.stringify({
        event: 'ai_execution_worker_failed',
        jobId: job?.id,
        errorMessage: err.message,
      }),
    );
  });

  console.log(
    JSON.stringify({
      event: 'influencer_ai_worker_started',
      queues: AI_EXECUTION_QUEUES,
      provider: env.aiProvider,
      model:
        env.aiProvider === 'anthropic' ? env.anthropicModel : env.ollamaModel,
      contractVersion: AI_CONTRACT_VERSION,
      brandDiscoveryOperations: [
        'PLAN_SEARCH',
        'SCORE_CANDIDATES',
        'RESEARCH_BRAND',
      ],
    }),
  );

  return {
    env,
    requestWorker,
    resultsQueue,
    eventsQueue,
    close: async () => {
      await requestWorker.close();
      await resultsQueue.close();
      await eventsQueue.close();
    },
  };
}
