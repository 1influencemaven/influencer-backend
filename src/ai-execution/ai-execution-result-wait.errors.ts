/**
 * Nest-side wait errors for {@link waitForAiExecutionResult}.
 * Distinct from worker `AiErrorCode` on FAILED results (those are returned, not thrown).
 */
export const AI_EXECUTION_WAIT_ERROR_CODES = {
  TIMEOUT: 'AI_EXECUTION_WAIT_TIMEOUT',
  NOT_FOUND: 'AI_EXECUTION_RESULT_NOT_FOUND',
  INFRASTRUCTURE: 'AI_EXECUTION_INFRASTRUCTURE_ERROR',
  INVALID_RESULT: 'AI_EXECUTION_INVALID_RESULT',
  CORRELATION_MISMATCH: 'AI_EXECUTION_CORRELATION_MISMATCH',
} as const;

export type AiExecutionWaitErrorCode =
  (typeof AI_EXECUTION_WAIT_ERROR_CODES)[keyof typeof AI_EXECUTION_WAIT_ERROR_CODES];

export class AiExecutionWaitError extends Error {
  readonly code: AiExecutionWaitErrorCode;
  readonly executionId: string;
  readonly cause?: unknown;

  constructor(
    code: AiExecutionWaitErrorCode,
    message: string,
    executionId: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'AiExecutionWaitError';
    this.code = code;
    this.executionId = executionId;
    this.cause = cause;
  }
}
