import { Agent } from '@mastra/core/agent';

import type { BrightDataToolsClient } from '../brightdata/client';
import { createContactResearchTools } from '../brightdata/tools';
import type { ContactResearchToolSession } from '../brightdata/session';
import type { InfluencerAiEnv } from '../config/env';
import { resolveMastraModel } from '../llm/resolve-model';
import { CONTACT_RESEARCH_FIND_AGENCY_EMAILS_INSTRUCTIONS } from '../prompts/contact-research-find-agency-emails.prompt';

/**
 * Contact Research agent — FIND_AGENCY_EMAILS (2C.4.4).
 * Reuses Bright Data tools; instructions are agency-scoped (not brand 2A).
 */
export function createContactResearchAgencyEmailsAgent(params: {
  env: InfluencerAiEnv;
  client: BrightDataToolsClient;
  session: ContactResearchToolSession;
}): Agent {
  const tools = createContactResearchTools({
    client: params.client,
    session: params.session,
  });

  return new Agent({
    id: 'contact-research-agency-emails',
    name: 'Agency Contact Emails Agent',
    instructions: CONTACT_RESEARCH_FIND_AGENCY_EMAILS_INSTRUCTIONS,
    model: resolveMastraModel(params.env) as never,
    tools,
  });
}
