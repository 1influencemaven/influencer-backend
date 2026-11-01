export { BBC_BRIGHTDATA_PROVIDER_ID } from './constants';
export type { BbcBrightDataProviderId } from './constants';

export { ContactDiscoveryModule } from './contact-discovery.module';
export { ContactDiscoveryService } from './contact-discovery.service';
export { ContactDiscoveryProcessor } from './processors/contact-discovery.processor';
export {
  contactDiscoveryJobId,
  type DiscoverBusinessContactsJobData,
} from './interfaces/discover-business-contacts-job.interface';
export {
  interpretBbcDiscoveryResult,
  type BbcJobInterpretation,
} from './utils/bbc-job-result.util';

export { BrightDataUnlockerAdapter } from './port/bright-data-unlocker.adapter';
export {
  BRIGHT_DATA_UNLOCKER_PORT,
  type BrightDataUnlockerPort,
  type UnlockerHtmlPortResult,
  type UnlockerSearchPortResult,
  type UnlockerProviderFailureKind,
} from './port/bright-data-unlocker.port';

export {
  BBC_V1_DEFAULT_MAX_PAGES,
  BBC_V1_FETCH_PATHS,
  BBC_V1_PRIMARY_PATHS,
  BBC_V1_SECONDARY_PATHS,
  buildBbcV1PageUrls,
  normalizeBbcPageUrl,
  normalizeWebsiteBase,
} from './pages/bbc-page-allowlist';

export { extractLiteralEmailObservations } from './extract/literal-email.extractor';
export { classifyAndDedupeBbcEmails } from './extract/classify-and-dedupe';
export type {
  BbcAcceptedEmailCandidate,
  BbcClassifyDedupeResult,
  BbcRawEmailObservation,
} from './extract/bbc-email-candidate';

export { BbcDiscoveryOrchestrator } from './orchestrator/bbc-discovery.orchestrator';
export type {
  BbcDiscoveryInput,
  BbcDiscoveryResult,
} from './orchestrator/bbc-discovery.orchestrator';
/** terminalStatusPersisted / partialContactsMayExist documented on BbcDiscoveryResult */
export type {
  BbcRunOutcome,
  BbcSearchMetadataV2,
} from './orchestrator/bbc-search-metadata';
export { resolveBbcRunOutcome } from './orchestrator/bbc-search-metadata';

