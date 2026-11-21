import { decideTrack2BExecution } from './track-2b-decision.util';

describe('decideTrack2BExecution (RF-03)', () => {
  it('skips 2B when HIGH present', () => {
    expect(
      decideTrack2BExecution({
        hasHigh: true,
        hasMedium: false,
        emailsPersistedThisRun: 1,
      }),
    ).toEqual({
      shouldRun: false,
      reason: 'SUFFICIENT_COMMERCIAL_COVERAGE_HIGH',
      hasHigh: true,
      hasMedium: false,
    });
  });

  it('skips 2B when MEDIUM present', () => {
    expect(
      decideTrack2BExecution({
        hasHigh: false,
        hasMedium: true,
        emailsPersistedThisRun: 1,
      }),
    ).toEqual({
      shouldRun: false,
      reason: 'SUFFICIENT_COMMERCIAL_COVERAGE_MEDIUM',
      hasHigh: false,
      hasMedium: true,
    });
  });

  it('skips 2B when HIGH and MEDIUM present', () => {
    expect(
      decideTrack2BExecution({
        hasHigh: true,
        hasMedium: true,
        emailsPersistedThisRun: 2,
      }).reason,
    ).toBe('SUFFICIENT_COMMERCIAL_COVERAGE_HIGH_AND_MEDIUM');
  });

  it('runs 2B for GENERAL/LOW/OTHER (insufficient coverage)', () => {
    expect(
      decideTrack2BExecution({
        hasHigh: false,
        hasMedium: false,
        emailsPersistedThisRun: 1,
      }),
    ).toEqual({
      shouldRun: true,
      reason: 'INSUFFICIENT_COMMERCIAL_COVERAGE',
      hasHigh: false,
      hasMedium: false,
    });
  });

  it('runs 2B when 2A persisted no emails', () => {
    expect(
      decideTrack2BExecution({
        hasHigh: false,
        hasMedium: false,
        emailsPersistedThisRun: 0,
      }).reason,
    ).toBe('NO_COMMERCIAL_EMAILS_FROM_2A');
  });
});
