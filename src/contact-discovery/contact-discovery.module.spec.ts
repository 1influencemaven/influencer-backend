jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../lead-discovery/brand-business-contact.service', () => ({
  BrandBusinessContactService: class BrandBusinessContactService {},
}));

jest.mock('../integrations/brightdata', () => ({
  BrightDataSearchClient: class BrightDataSearchClient {},
  BrightDataModule: class BrightDataModule {},
}));

import { CONTACT_DISCOVERY_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import { BRIGHT_DATA_UNLOCKER_PORT } from './port/bright-data-unlocker.port';
import { ContactDiscoveryModule } from './contact-discovery.module';
import { ContactDiscoveryService } from './contact-discovery.service';
import { ContactDiscoveryProcessor } from './processors/contact-discovery.processor';
import { BbcDiscoveryOrchestrator } from './orchestrator/bbc-discovery.orchestrator';
import { BrightDataUnlockerAdapter } from './port/bright-data-unlocker.adapter';

/**
 * Lightweight registration contract tests (no Redis / Nest TestingModule).
 * Ensures T4 wiring constants and exports stay aligned.
 */
describe('ContactDiscoveryModule registration contracts', () => {
  it('exports ContactDiscoveryModule class', () => {
    expect(ContactDiscoveryModule).toBeDefined();
  });

  it('registers dedicated contact-discovery queue (not prospecting)', () => {
    expect(QUEUES.CONTACT_DISCOVERY).toBe('contact-discovery');
    expect(QUEUES.CONTACT_DISCOVERY).not.toBe(QUEUES.PROSPECTING);
    expect(CONTACT_DISCOVERY_JOBS.DISCOVER_BUSINESS_CONTACTS).toBe(
      'discover-business-contacts',
    );
    expect(CONTACT_DISCOVERY_JOBS.DISCOVER_BUSINESS_CONTACTS).not.toBe(
      'find-leads',
    );
  });

  it('exposes DI tokens used by the module', () => {
    expect(BRIGHT_DATA_UNLOCKER_PORT).toBeDefined();
    expect(ContactDiscoveryService).toBeDefined();
    expect(ContactDiscoveryProcessor).toBeDefined();
    expect(BbcDiscoveryOrchestrator).toBeDefined();
    expect(BrightDataUnlockerAdapter).toBeDefined();
  });
});
