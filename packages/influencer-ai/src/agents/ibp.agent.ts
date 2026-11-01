import { Agent } from '@mastra/core/agent';

import type { InfluencerAiEnv } from '../config/env';
import { resolveMastraModel } from '../llm/resolve-model';
import { DEFAULT_IBP_INSTRUCTIONS } from '../prompts/ibp.prompt';

export function createIbpAgent(env: InfluencerAiEnv): Agent {
  return new Agent({
    id: 'ibp-generation',
    name: 'IBP Generation Agent',
    instructions: DEFAULT_IBP_INSTRUCTIONS,
    // Mastra accepts provider/model string or LanguageModelV2-compatible object
    model: resolveMastraModel(env) as never,
  });
}
