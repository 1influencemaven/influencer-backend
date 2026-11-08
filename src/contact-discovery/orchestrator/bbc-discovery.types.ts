import type { BbcRunOutcome, BbcSearchMetadataV2 } from './bbc-search-metadata';

/**
 * Result shape shared by Contact Discovery job runners (Mastra FIND_BRAND_EMAILS).
 * Persistence of contacts and run status is not a single DB transaction.
 */
export type BbcDiscoveryResult = {
  outcome: BbcRunOutcome | null;
  runStatus: 'COMPLETED' | 'FAILED';
  errorMessage: string | null;
  searchMetadata: BbcSearchMetadataV2 | null;
  contactsCreated: number;
  contactsUpdated: number;
  /** True only when the terminal COMPLETED/FAILED write to LeadDiscoveryRun succeeded. */
  terminalStatusPersisted: boolean;
  /**
   * True when at least one contact upsert succeeded before a later failure,
   * or when COMPLETED write failed after upserts.
   */
  partialContactsMayExist: boolean;
};
