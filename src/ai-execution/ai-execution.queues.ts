/** ADR-0023 physical queue names (shared with influencer-ai). */
export const AI_EXECUTION_QUEUES = {
  REQUESTS: 'ai.execution.requests',
  RESULTS: 'ai.execution.results',
  EVENTS: 'ai.execution.events',
} as const;

export const AI_EXECUTION_JOBS = {
  EXECUTE: 'ai.execute',
  RESULT: 'ai.result',
  EVENT: 'ai.event',
} as const;
