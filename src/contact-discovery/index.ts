export {
  BBC_BRIGHTDATA_PROVIDER_ID,
  BBC_V1_DEFAULT_MAX_PAGES,
  MASTRA_CONTACT_EMAILS_PROVIDER_ID,
} from './constants';
export type {
  BbcBrightDataProviderId,
  MastraContactEmailsProviderId,
} from './constants';

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

export type { BbcDiscoveryResult } from './orchestrator/bbc-discovery.types';
export type {
  BbcRunOutcome,
  BbcSearchMetadataV2,
  UnlockerProviderFailureKind,
} from './orchestrator/bbc-search-metadata';
export { resolveBbcRunOutcome } from './orchestrator/bbc-search-metadata';
