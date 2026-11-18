import {
  buildContactResearchTimings,
  readAiDurationMs,
} from './contact-research-timings';

describe('contact-research-timings (RF-04.1)', () => {
  it('propagates finite durationMs and rejects missing/invalid', () => {
    expect(readAiDurationMs({ durationMs: 1234 })).toBe(1234);
    expect(readAiDurationMs({ durationMs: 0 })).toBe(0);
    expect(readAiDurationMs({})).toBeNull();
    expect(readAiDurationMs({ durationMs: undefined })).toBeNull();
    expect(readAiDurationMs({ durationMs: '900' })).toBeNull();
    expect(readAiDurationMs({ durationMs: -1 })).toBeNull();
    expect(readAiDurationMs({ durationMs: Number.NaN })).toBeNull();
  });

  it('builds 2A-only timings when 2B omitted', () => {
    expect(
      buildContactResearchTimings({
        wait2AMs: 10.4,
        aiDuration2AMs: 5000,
        totalOrchestratorMs: 5200.2,
      }),
    ).toEqual({
      wait2AMs: 10,
      aiDuration2AMs: 5000,
      totalOrchestratorMs: 5200,
    });
  });

  it('includes 2B wait/duration only when wait actually started', () => {
    expect(
      buildContactResearchTimings({
        wait2AMs: 100,
        aiDuration2AMs: null,
        totalOrchestratorMs: 900,
        track2BWait: { wait2BMs: 200.6, aiDuration2BMs: 7000 },
      }),
    ).toEqual({
      wait2AMs: 100,
      aiDuration2AMs: null,
      wait2BMs: 201,
      aiDuration2BMs: 7000,
      totalOrchestratorMs: 900,
    });
  });

  it('omits 2B fields when wait never started (publish fail / RF-03 skip)', () => {
    expect(
      buildContactResearchTimings({
        wait2AMs: 50,
        aiDuration2AMs: 1000,
        totalOrchestratorMs: 80,
      }),
    ).toEqual({
      wait2AMs: 50,
      aiDuration2AMs: 1000,
      totalOrchestratorMs: 80,
    });
  });
});
