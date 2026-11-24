import { decideTrack2BExecution } from './track-2b-decision.util';

describe('decideTrack2BExecution (RF-03 v2)', () => {
  it('skips 2B only when a verified nominal email (Tier 1) exists', () => {
    expect(
      decideTrack2BExecution({
        hasHigh: false,
        hasMedium: false,
        emailsPersistedThisRun: 0,
        hasTier1Nominal: true,
      }),
    ).toEqual({
      shouldRun: false,
      reason: 'TIER1_NOMINAL_FOUND',
      hasHigh: false,
      hasMedium: false,
    });
  });

  it('still runs 2B when only a HIGH mailbox exists (Tier 2 < Tier 1)', () => {
    expect(
      decideTrack2BExecution({
        hasHigh: true,
        hasMedium: false,
        emailsPersistedThisRun: 1,
      }),
    ).toEqual({
      shouldRun: true,
      reason: 'MAILBOX_ONLY_HIGH',
      hasHigh: true,
      hasMedium: false,
    });
  });

  it('still runs 2B when only MEDIUM / HIGH+MEDIUM mailboxes exist', () => {
    expect(
      decideTrack2BExecution({
        hasHigh: false,
        hasMedium: true,
        emailsPersistedThisRun: 1,
      }).reason,
    ).toBe('MAILBOX_ONLY_MEDIUM');
    const both = decideTrack2BExecution({
      hasHigh: true,
      hasMedium: true,
      emailsPersistedThisRun: 2,
    });
    expect(both.shouldRun).toBe(true);
    expect(both.reason).toBe('MAILBOX_ONLY_HIGH_AND_MEDIUM');
  });

  it('runs 2B for GENERAL/LOW/OTHER (insufficient coverage)', () => {
    expect(
      decideTrack2BExecution({
        hasHigh: false,
        hasMedium: false,
        emailsPersistedThisRun: 1,
      }).reason,
    ).toBe('INSUFFICIENT_COMMERCIAL_COVERAGE');
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
