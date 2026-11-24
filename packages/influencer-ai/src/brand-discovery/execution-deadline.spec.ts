import { executionDeadlineSignal } from './execution-deadline';

describe('executionDeadlineSignal', () => {
  it('returns undefined when Nest sent no timeout', () => {
    expect(
      executionDeadlineSignal({ requestedAt: new Date().toISOString() }),
    ).toBeUndefined();
  });

  it('is already aborted when the Nest wait budget has elapsed', async () => {
    const signal = executionDeadlineSignal({
      requestedAt: new Date(Date.now() - 10_000).toISOString(),
      limits: { timeoutMs: 5_000 },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(signal?.aborted).toBe(true);
  });

  it('stays open while budget remains', () => {
    const signal = executionDeadlineSignal({
      requestedAt: new Date().toISOString(),
      limits: { timeoutMs: 60_000 },
    });
    expect(signal?.aborted).toBe(false);
  });
});
