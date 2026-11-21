import { Logger } from '@nestjs/common';
import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import { AI_EXECUTION_JOBS } from './ai-execution.queues';
import { AiExecutionEventProcessor } from './ai-execution-event.processor';

const EXECUTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORRELATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    eventId: EVENT_ID,
    executionId: EXECUTION_ID,
    correlationId: CORRELATION_ID,
    type: 'IBP_GENERATION',
    name: 'ai.execution.started',
    sequence: 1,
    occurredAt: '2026-11-01T16:26:04.000Z',
    payload: { kind: 'empty' },
    ...overrides,
  };
}

describe('AiExecutionEventProcessor', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs a valid IBP event (observability only; no Prisma / no state mutation)', async () => {
    const processor = new AiExecutionEventProcessor();

    await processor.process({
      id: `event-${EVENT_ID}`,
      name: AI_EXECUTION_JOBS.EVENT,
      data: validEvent({
        name: 'ai.execution.completed',
        sequence: 2,
        payload: { kind: 'terminal', status: 'COMPLETED' },
      }),
    } as never);

    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'ai_execution_event',
        name: 'ai.execution.completed',
        type: 'IBP_GENERATION',
        executionId: EXECUTION_ID,
        sequence: 2,
        payloadKind: 'terminal',
      }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs valid events for other capability types without business side effects', async () => {
    const processor = new AiExecutionEventProcessor();

    await processor.process({
      id: 'event-brand',
      name: AI_EXECUTION_JOBS.EVENT,
      data: validEvent({
        type: 'BRAND_DISCOVERY',
        name: 'ai.execution.accepted',
        sequence: 0,
      }),
    } as never);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"type":"BRAND_DISCOVERY"'),
    );
  });

  it('ignores jobs that are not ai.event (unsupported job name)', async () => {
    const processor = new AiExecutionEventProcessor();

    await processor.process({
      id: 'x',
      name: 'ai.result',
      data: validEvent(),
    } as never);

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns and does not throw on invalid event contract', async () => {
    const processor = new AiExecutionEventProcessor();

    await expect(
      processor.process({
        id: 'bad-event',
        name: AI_EXECUTION_JOBS.EVENT,
        data: { not: 'an-event' },
      } as never),
    ).resolves.toBeUndefined();

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid AiExecutionEvent job bad-event'),
    );
  });

  it('treats unknown executionId / finalized runs as log-only (architecture: no DB lookup)', async () => {
    const processor = new AiExecutionEventProcessor();

    await processor.process({
      id: 'event-orphan',
      name: AI_EXECUTION_JOBS.EVENT,
      data: validEvent({
        executionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        name: 'ai.execution.failed',
        payload: {
          kind: 'terminal',
          status: 'FAILED',
          errorCode: 'AI_PROVIDER_ERROR',
        },
      }),
    } as never);

    expect(logSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs duplicate valid events independently (idempotent observability)', async () => {
    const processor = new AiExecutionEventProcessor();
    const job = {
      id: `event-${EVENT_ID}`,
      name: AI_EXECUTION_JOBS.EVENT,
      data: validEvent(),
    };

    await processor.process(job as never);
    await processor.process(job as never);

    expect(logSpy).toHaveBeenCalledTimes(2);
  });
});
