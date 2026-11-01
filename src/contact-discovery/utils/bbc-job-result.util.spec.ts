import { interpretBbcDiscoveryResult } from './bbc-job-result.util';
import type { BbcDiscoveryResult } from '../orchestrator/bbc-discovery.orchestrator';

describe('interpretBbcDiscoveryResult', () => {
  const base: BbcDiscoveryResult = {
    outcome: null,
    runStatus: 'FAILED',
    errorMessage: 'CONTACT_PERSIST_FAILED: boom',
    searchMetadata: null,
    contactsCreated: 0,
    contactsUpdated: 0,
    terminalStatusPersisted: false,
    partialContactsMayExist: false,
  };

  it('does not treat in-memory FAILED as a persisted terminal without the flag', () => {
    const interpreted = interpretBbcDiscoveryResult(base);
    expect(interpreted.runStatus).toBe('FAILED');
    expect(interpreted.terminalStatusPersisted).toBe(false);
    expect(interpreted.jobComplete).toBe(false);
    expect(interpreted.shouldRetryForTerminalPersist).toBe(true);
    expect(interpreted.outcome).toBeNull();
  });

  it('never invents RESULTS_FOUND when outcome is null', () => {
    const interpreted = interpretBbcDiscoveryResult({
      ...base,
      terminalStatusPersisted: true,
      partialContactsMayExist: true,
      contactsCreated: 2,
    });
    expect(interpreted.outcome).toBeNull();
    expect(interpreted.outcome).not.toBe('RESULTS_FOUND');
    expect(interpreted.jobComplete).toBe(true);
    expect(interpreted.shouldRetryForTerminalPersist).toBe(false);
    expect(interpreted.partialContactsMayExist).toBe(true);
  });

  it('marks COMPLETED + RESULTS_FOUND as job complete when persisted', () => {
    const interpreted = interpretBbcDiscoveryResult({
      ...base,
      outcome: 'RESULTS_FOUND',
      runStatus: 'COMPLETED',
      errorMessage: null,
      terminalStatusPersisted: true,
      contactsCreated: 1,
    });
    expect(interpreted.jobComplete).toBe(true);
    expect(interpreted.outcome).toBe('RESULTS_FOUND');
  });
});
