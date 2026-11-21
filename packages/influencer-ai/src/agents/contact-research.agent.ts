import { Agent } from '@mastra/core/agent';

import type { BrightDataToolsClient } from '../brightdata/client';
import { createContactResearchTools } from '../brightdata/tools';
import type { ContactResearchToolSession } from '../brightdata/session';
import type { InfluencerAiEnv } from '../config/env';
import { resolveMastraModel } from '../llm/resolve-model';
import { CONTACT_RESEARCH_FIND_EMAILS_INSTRUCTIONS } from '../prompts/contact-research-find-emails.prompt';

/**
 * Contact Research agent — FIND_BRAND_EMAILS with Bright Data tools (2A).
 * Tools are bound per-run (session + client) so budgets stay isolated.
 */
export function createContactResearchAgent(params: {
  env: InfluencerAiEnv;
  client: BrightDataToolsClient;
  session: ContactResearchToolSession;
}): Agent {
  const tools = createContactResearchTools({
    client: params.client,
    session: params.session,
  });

  return new Agent({
    id: 'contact-research',
    name: 'Contact Research Agent',
    instructions: CONTACT_RESEARCH_FIND_EMAILS_INSTRUCTIONS,
    model: resolveMastraModel(params.env) as never,
    tools,
  });
}
