import type { BbcDiscoveryResult } from '../orchestrator/bbc-discovery.orchestrator';

/**
 * Translates an in-process orchestrator result for the processor / callers.
 *
 * Critical: `runStatus === 'FAILED'` alone does **not** mean FAILED is in DB.
 * Only `terminalStatusPersisted === true` proves a terminal LeadDiscoveryRun write.
 * Never promote `outcome: null` to RESULTS_FOUND.
 */
export type BbcJobInterpretation = {
  runStatus: BbcDiscoveryResult['runStatus'];
  outcome: BbcDiscoveryResult['outcome'];
  terminalStatusPersisted: boolean;
  partialContactsMayExist: boolean;
  /** Safe to treat the BullMQ job as finished (no retry for status write). */
  jobComplete: boolean;
  /** True when BullMQ should retry because terminal status may still be PROCESSING. */
  shouldRetryForTerminalPersist: boolean;
  errorMessage: string | null;
  contactsCreated: number;
  contactsUpdated: number;
};

export function interpretBbcDiscoveryResult(
  result: BbcDiscoveryResult,
): BbcJobInterpretation {
  const terminalStatusPersisted = result.terminalStatusPersisted === true;
  return {
    runStatus: result.runStatus,
    outcome: result.outcome,
    terminalStatusPersisted,
    partialContactsMayExist: result.partialContactsMayExist === true,
    jobComplete: terminalStatusPersisted,
    shouldRetryForTerminalPersist: !terminalStatusPersisted,
    errorMessage: result.errorMessage,
    contactsCreated: result.contactsCreated,
    contactsUpdated: result.contactsUpdated,
  };
}
