/** Physical queue names — ADR-0023 / AI-002 v1.0 */
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
