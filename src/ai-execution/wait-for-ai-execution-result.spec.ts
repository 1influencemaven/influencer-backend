import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import {
  AI_EXECUTION_WAIT_ERROR_CODES,
  AiExecutionWaitError,
} from './ai-execution-result-wait.errors';
import {
  aiExecutionResultJobId,
  waitForAiExecutionResult,
} from './wait-for-ai-execution-result';

const EXECUTION_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_EXECUTION_ID = '66666666-6666-4666-8666-666666666666';
const CORRELATION_ID = '22222222-2222-4222-8222-222222222222';

function completedBrandResult(overrides?: Record<string, unknown>) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: EXECUTION_ID,
    correlationId: CORRELATION_ID,
    type: 'BRAND_DISCOVERY',
    status: 'COMPLETED',
    startedAt: '2026-10-30T20:02:01.000Z',
    finishedAt: '2026-10-30T20:02:04.000Z',
    durationMs: 3000,
    metadata: {
      provider: 'ollama',
      model: 'llama3.2:3b',
      llmCallCount: 1,
    },
    output: {
      operation: 'PLAN_SEARCH',
      queries: [
        'wellness sportswear brand Spain influencer marketing',
        'sustainable fitness apparel brand Spain',
      ],
    },
    ...overrides,
  };
}

function failedBrandResult() {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: EXECUTION_ID,
    correlationId: CORRELATION_ID,
    type: 'BRAND_DISCOVERY',
    status: 'FAILED',
    startedAt: '2026-10-30T20:02:01.000Z',
    finishedAt: '2026-10-30T20:02:04.000Z',
    durationMs: 3000,
    metadata: {
      provider: 'ollama',
      model: 'llama3.2:3b',
      llmCallCount: 1,
    },
    error: {
      code: 'AI_PROVIDER_ERROR',
      message: 'LLM unavailable',
      retryable: true,
      occurredAt: '2026-10-30T20:02:04.000Z',
    },
  };
}

describe('waitForAiExecutionResult', () => {
  it('exposes result-{executionId} job id helper', () => {
    expect(aiExecutionResultJobId(EXECUTION_ID)).toBe(`result-${EXECUTION_ID}`);
    expect(aiExecutionResultJobId(EXECUTION_ID)).not.toContain(':');
  });

  it('returns COMPLETED when the result job is already available', async () => {
    const payload = completedBrandResult();
    const getJob = jest.fn().mockResolvedValue({ data: payload });

    const result = await waitForAiExecutionResult(
      { getJob } as never,
      EXECUTION_ID,
      5_000,
    );

    expect(getJob).toHaveBeenCalledWith(`result-${EXECUTION_ID}`);
    expect(result.status).toBe('COMPLETED');
    expect(result.executionId).toBe(EXECUTION_ID);
    expect(result.type).toBe('BRAND_DISCOVERY');
  });

  it('returns COMPLETED when the result arrives after wait starts', async () => {
    const payload = completedBrandResult();
    const getJob = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ data: payload });

    let clock = 0;
    const sleep = jest.fn((ms: number) => {
      clock += ms;
      return Promise.resolve();
    });

    const result = await waitForAiExecutionResult(
      { getJob } as never,
      EXECUTION_ID,
      1_000,
      {
        pollIntervalMs: 50,
        now: () => clock,
        sleep,
      },
    );

    expect(result.status).toBe('COMPLETED');
    expect(getJob.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(sleep).toHaveBeenCalled();
  });

  it('returns FAILED worker results without throwing', async () => {
    const getJob = jest.fn().mockResolvedValue({ data: failedBrandResult() });

    const result = await waitForAiExecutionResult(
      { getJob } as never,
      EXECUTION_ID,
      1_000,
    );

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('AI_PROVIDER_ERROR');
  });

  it('throws TIMEOUT when the result never appears within timeoutMs', async () => {
    const getJob = jest.fn().mockResolvedValue(null);
    let clock = 0;
    const sleep = jest.fn((ms: number) => {
      clock += ms;
      return Promise.resolve();
    });

    await expect(
      waitForAiExecutionResult({ getJob } as never, EXECUTION_ID, 150, {
        pollIntervalMs: 50,
        now: () => clock,
        sleep,
      }),
    ).rejects.toMatchObject({
      code: AI_EXECUTION_WAIT_ERROR_CODES.TIMEOUT,
      executionId: EXECUTION_ID,
    });

    expect(clock).toBeGreaterThanOrEqual(150);
  });

  it('throws NOT_FOUND on immediate miss when timeoutMs is 0', async () => {
    const getJob = jest.fn().mockResolvedValue(null);

    await expect(
      waitForAiExecutionResult({ getJob } as never, EXECUTION_ID, 0),
    ).rejects.toMatchObject({
      code: AI_EXECUTION_WAIT_ERROR_CODES.NOT_FOUND,
      executionId: EXECUTION_ID,
    });

    expect(getJob).toHaveBeenCalledTimes(1);
  });

  it('throws INFRASTRUCTURE when BullMQ/Redis getJob fails', async () => {
    const redisError = new Error('ECONNREFUSED Redis');
    const getJob = jest.fn().mockRejectedValue(redisError);

    try {
      await waitForAiExecutionResult({ getJob } as never, EXECUTION_ID, 1_000);
      fail('expected INFRASTRUCTURE error');
    } catch (error) {
      expect(error).toBeInstanceOf(AiExecutionWaitError);
      const waitError = error as AiExecutionWaitError;
      expect(waitError.code).toBe(AI_EXECUTION_WAIT_ERROR_CODES.INFRASTRUCTURE);
      expect(waitError.cause).toBe(redisError);
      expect(waitError.message).toContain('ECONNREFUSED Redis');
    }
  });

  it('throws CORRELATION_MISMATCH when payload executionId differs', async () => {
    const payload = completedBrandResult({
      executionId: OTHER_EXECUTION_ID,
    });
    const getJob = jest.fn().mockResolvedValue({ data: payload });

    await expect(
      waitForAiExecutionResult({ getJob } as never, EXECUTION_ID, 1_000),
    ).rejects.toMatchObject({
      code: AI_EXECUTION_WAIT_ERROR_CODES.CORRELATION_MISMATCH,
      executionId: EXECUTION_ID,
    });
  });

  it('throws INVALID_RESULT when payload fails the AiExecutionResult contract', async () => {
    const getJob = jest.fn().mockResolvedValue({
      data: {
        contractVersion: AI_CONTRACT_VERSION,
        executionId: EXECUTION_ID,
        // missing required fields
        type: 'BRAND_DISCOVERY',
        status: 'COMPLETED',
      },
    });

    await expect(
      waitForAiExecutionResult({ getJob } as never, EXECUTION_ID, 1_000),
    ).rejects.toMatchObject({
      code: AI_EXECUTION_WAIT_ERROR_CODES.INVALID_RESULT,
      executionId: EXECUTION_ID,
    });
  });

  it('recovers a result that was published before the wait began', async () => {
    const payload = completedBrandResult();
    const getJob = jest.fn().mockResolvedValue({ data: payload });
    const sleep = jest.fn();

    const result = await waitForAiExecutionResult(
      { getJob } as never,
      EXECUTION_ID,
      5_000,
      { sleep },
    );

    expect(result.status).toBe('COMPLETED');
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
