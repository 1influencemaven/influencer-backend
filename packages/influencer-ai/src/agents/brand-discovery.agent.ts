import { Agent } from '@mastra/core/agent';

import type { InfluencerAiEnv } from '../config/env';
import { resolveMastraModel } from '../llm/resolve-model';

/**
 * Shared role for Brand Discovery operations (PLAN_SEARCH, SCORE_CANDIDATES).
 * Operation-specific commercial guidance lives in each user prompt builder.
 */
export const BRAND_DISCOVERY_AGENT_INSTRUCTIONS = `You are the Brand Discovery agent for influencer marketing.

You execute Brand Discovery operations. For each request, follow only the operation-specific instructions and output contract provided in the user message.

Do not assume responsibilities of a different operation than the one described in the user message.
Do not invent tools, external searches, or side effects beyond returning the requested structured result.`;

/**
 * Single logical Brand Discovery agent (PLAN_SEARCH and SCORE_CANDIDATES).
 * No tools - Nest owns SERP / Bright Data.
 */
export function createBrandDiscoveryAgent(env: InfluencerAiEnv): Agent {
  return new Agent({
    id: 'brand-discovery',
    name: 'Brand Discovery Agent',
    instructions: BRAND_DISCOVERY_AGENT_INSTRUCTIONS,
    model: resolveMastraModel(env) as never,
  });
}
