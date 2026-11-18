jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';

import { LeadDiscoveryStatus } from '../../generated/prisma/enums';
import { CONTACT_DISCOVERY_JOBS } from '../../bullmq/job-types';
import { ContactDiscoveryProcessor } from './contact-discovery.processor';
import type { DiscoverBusinessContactsJobData } from '../interfaces/discover-business-contacts-job.interface';
import type { BbcDiscoveryResult } from '../orchestrator/bbc-discovery.types';

describe('ContactDiscoveryProcessor', () => {
  const mastraExecute = jest.fn();
  const mastraOrchestrator = { execute: mastraExecute };

  const findUnique = jest.fn();
  const brandFindUnique = jest.fn();
  const prisma = {
    leadDiscoveryRun: { findUnique },
    brandCandidate: { findUnique: brandFindUnique },
  };

  let processor: ContactDiscoveryProcessor;

  const jobData: DiscoverBusinessContactsJobData = {
    runId: 'run-1',
    brandCandidateId: 'b1',
    influencerId: 'i1',
    website: 'https://brand.com',
    domain: 'brand.com',
    maxPages: 3,
  };

  function makeJob(
    overrides: Partial<Job<DiscoverBusinessContactsJobData>> = {},
  ): Job<DiscoverBusinessContactsJobData> {
    return {
      id: 'job-1',
      name: CONTACT_DISCOVERY_JOBS.DISCOVER_BUSINESS_CONTACTS,
      data: jobData,
      attemptsMade: 0,
      ...overrides,
    } as Job<DiscoverBusinessContactsJobData>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({
      id: 'run-1',
      status: LeadDiscoveryStatus.PROCESSING,
      brandCandidateId: 'b1',
    });
    brandFindUnique.mockResolvedValue({
      name: 'Brand Co',
      evidenceUrls: ['https://brand.com/press'],
      influencer: { niche: 'home' },
    });
    processor = new ContactDiscoveryProcessor(
      mastraOrchestrator as never,
      prisma as never,
    );
  });

  it('skips when run already COMPLETED (idempotent retry / duplicate job)', async () => {
    findUnique.mockResolvedValue({
      id: 'run-1',
      status: LeadDiscoveryStatus.COMPLETED,
      brandCandidateId: 'b1',
    });

    const result = await processor.process(makeJob());

    expect(result).toEqual({
      skipped: true,
      runStatus: LeadDiscoveryStatus.COMPLETED,
    });
    expect(mastraExecute).not.toHaveBeenCalled();
  });

  it('skips when run already FAILED', async () => {
    findUnique.mockResolvedValue({
      id: 'run-1',
      status: LeadDiscoveryStatus.FAILED,
      brandCandidateId: 'b1',
    });

    const result = await processor.process(makeJob());

    expect(result.skipped).toBe(true);
    expect(mastraExecute).not.toHaveBeenCalled();
  });

  it('RF-02.1: drops invalid seedUrls and still completes (no job failure)', async () => {
    brandFindUnique.mockResolvedValue({
      name: 'Brand Co',
      evidenceUrls: [
        'not-a-url',
        '',
        'ftp://brand.com/x',
        'https://brand.com/press',
        'javascript:alert(1)',
      ],
      influencer: { niche: 'home' },
    });
    mastraExecute.mockResolvedValue({
      outcome: 'RESULTS_FOUND',
      runStatus: 'COMPLETED',
      errorMessage: null,
      searchMetadata: null,
      contactsCreated: 0,
      contactsUpdated: 0,
      terminalStatusPersisted: true,
      partialContactsMayExist: false,
    } satisfies BbcDiscoveryResult);

    await processor.process(makeJob());

    expect(mastraExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        seedUrls: ['https://brand.com/press'],
      }),
    );
  });

  it('completes job when Mastra persisted COMPLETED + RESULTS_FOUND', async () => {
    const orchResult: BbcDiscoveryResult = {
      outcome: 'RESULTS_FOUND',
      runStatus: 'COMPLETED',
      errorMessage: null,
      searchMetadata: null,
      contactsCreated: 1,
      contactsUpdated: 0,
      terminalStatusPersisted: true,
      partialContactsMayExist: false,
    };
    mastraExecute.mockResolvedValue(orchResult);

    const result = await processor.process(makeJob());

    expect(mastraExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        brandCandidateId: 'b1',
        website: 'https://brand.com',
        brandName: 'Brand Co',
        niche: 'home',
        seedUrls: ['https://brand.com/press'],
      }),
    );
    expect(result).toEqual({
      runStatus: 'COMPLETED',
      outcome: 'RESULTS_FOUND',
      terminalStatusPersisted: true,
      partialContactsMayExist: false,
    });
  });

  it('completes job when FAILED was persisted (no BullMQ retry)', async () => {
    mastraExecute.mockResolvedValue({
      outcome: null,
      runStatus: 'FAILED',
      errorMessage: 'CONTACT_PERSIST_FAILED: boom',
      searchMetadata: null,
      contactsCreated: 0,
      contactsUpdated: 0,
      terminalStatusPersisted: true,
      partialContactsMayExist: false,
    } satisfies BbcDiscoveryResult);

    const result = await processor.process(makeJob());

    expect(result.runStatus).toBe('FAILED');
    expect(result.terminalStatusPersisted).toBe(true);
  });

  it('throws to retry when terminalStatusPersisted is false', async () => {
    mastraExecute.mockResolvedValue({
      outcome: null,
      runStatus: 'FAILED',
      errorMessage:
        'CONTACT_PERSIST_FAILED: boom | FAILED_STATUS_NOT_PERSISTED: x',
      searchMetadata: null,
      contactsCreated: 1,
      contactsUpdated: 0,
      terminalStatusPersisted: false,
      partialContactsMayExist: true,
    } satisfies BbcDiscoveryResult);

    await expect(processor.process(makeJob())).rejects.toThrow(
      /BBC_TERMINAL_STATUS_NOT_PERSISTED/,
    );
  });

  it('throws UnrecoverableError when run is missing', async () => {
    findUnique.mockResolvedValue(null);
    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(mastraExecute).not.toHaveBeenCalled();
  });

  it('skips unknown job names without calling Mastra', async () => {
    const result = await processor.process(
      makeJob({ name: 'find-leads' } as never),
    );
    expect(result).toEqual({ skipped: true });
    expect(mastraExecute).not.toHaveBeenCalled();
  });
});
