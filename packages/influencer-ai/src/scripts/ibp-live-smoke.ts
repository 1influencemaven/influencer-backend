/**
 * Live smoke against local Ollama (no BullMQ).
 * Usage: npm run test:ibp-live -w @influence-maven/influencer-ai
 */
import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import { createIbpAgent } from '../agents/ibp.agent';
import { loadInfluencerAiEnv, assertProviderReady } from '../config/env';
import { runIbpGeneration } from '../ibp/run-ibp';

async function main(): Promise<void> {
  const env = loadInfluencerAiEnv();
  assertProviderReady(env);
  const agent = createIbpAgent(env);

  const result = await runIbpGeneration(agent, {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: '33333333-3333-4333-8333-333333333333',
    correlationId: '44444444-4444-4444-8444-444444444444',
    idempotencyKey: `ibp-live:${Date.now()}`,
    requestedAt: new Date().toISOString(),
    type: 'IBP_GENERATION',
    context: {
      userId: 'live-smoke',
      influencerId: 'live-inf',
      resourceId: 'live-inf',
      resourceType: 'IDEAL_BRAND_PROFILE',
    },
    instructions: { business: 'Produce a concise Ideal Brand Profile as JSON.' },
    configuration: {
      provider: env.aiProvider,
      model: env.aiProvider === 'anthropic' ? env.anthropicModel : env.ollamaModel,
    },
    input: {
      influencer: {
        id: 'live-inf',
        name: 'Live Smoke Creator',
        niche: 'fitness',
        platforms: ['instagram', 'tiktok'],
        audienceSize: 25000,
        audienceLocation: 'Spain',
        contentStyle: 'training tips',
      },
    },
  });

  console.log(JSON.stringify({ event: 'ibp_live_smoke_result', result }, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
