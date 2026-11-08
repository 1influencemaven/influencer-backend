/**
 * Errors thrown by {@link BrandDiscoveryAiOrchestrator}.
 * Worker FAILED codes (e.g. AI_PROVIDER_ERROR) are preserved on `code`.
 */
export const BRAND_DISCOVERY_AI_ERROR_CODES = {
  PLAN_FAILED: 'BRAND_DISCOVERY_PLAN_FAILED',
  PLAN_INVALID_OPERATION: 'BRAND_DISCOVERY_PLAN_INVALID_OPERATION',
  SCORE_FAILED: 'BRAND_DISCOVERY_SCORE_FAILED',
  SCORE_INVALID_OPERATION: 'BRAND_DISCOVERY_SCORE_INVALID_OPERATION',
  WAIT: 'BRAND_DISCOVERY_AI_WAIT_ERROR',
} as const;

export type BrandDiscoveryAiErrorCode = string;

export class BrandDiscoveryAiOrchestratorError extends Error {
  readonly code: BrandDiscoveryAiErrorCode;
  readonly executionId?: string;
  readonly cause?: unknown;

  constructor(
    code: BrandDiscoveryAiErrorCode,
    message: string,
    options?: { executionId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'BrandDiscoveryAiOrchestratorError';
    this.code = code;
    this.executionId = options?.executionId;
    this.cause = options?.cause;
  }
}
