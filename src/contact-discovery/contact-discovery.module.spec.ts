jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../lead-discovery/brand-business-contact.service', () => ({
  BrandBusinessContactService: class BrandBusinessContactService {},
}));

import { CONTACT_DISCOVERY_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import { ContactDiscoveryModule } from './contact-discovery.module';
import { ContactDiscoveryService } from './contact-discovery.service';
import { ContactDiscoveryProcessor } from './processors/contact-discovery.processor';
import { ContactEmailMastraOrchestrator } from './orchestrator/contact-email-mastra.orchestrator';

/**
 * Lightweight registration contract tests (no Redis / Nest TestingModule).
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

  it('exposes Mastra-only DI tokens used by the module', () => {
    expect(ContactDiscoveryService).toBeDefined();
    expect(ContactDiscoveryProcessor).toBeDefined();
    expect(ContactEmailMastraOrchestrator).toBeDefined();
  });
});
