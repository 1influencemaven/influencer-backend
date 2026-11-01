jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../../lead-discovery/brand-business-contact.service', () => ({
  BrandBusinessContactService: class BrandBusinessContactService {},
}));

import { LeadDiscoveryStatus } from '../../generated/prisma/enums';
import { CommercialRelevance } from '../../generated/prisma/enums';

import type { BrightDataUnlockerPort } from '../port/bright-data-unlocker.port';
import { BbcDiscoveryOrchestrator } from './bbc-discovery.orchestrator';

describe('BbcDiscoveryOrchestrator', () => {
  const fetchHtml = jest.fn();
  const isConfigured = jest.fn(() => true);
  const unlocker = {
    fetchHtml,
    search: jest.fn(),
    isConfigured,
  } as unknown as BrightDataUnlockerPort;

  const upsertFromDiscovery = jest.fn();
  const brandBusinessContacts = {
    upsertFromDiscovery,
  };

  const leadDiscoveryRunUpdate = jest.fn();
  const prisma = {
    leadDiscoveryRun: { update: leadDiscoveryRunUpdate },
  };

  let orchestrator: BbcDiscoveryOrchestrator;

  const input = {
    runId: 'run-1',
    brandCandidateId: 'brand-1',
    website: 'https://brand.com',
    domain: 'brand.com',
    maxPages: 3,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    isConfigured.mockReturnValue(true);
    leadDiscoveryRunUpdate.mockResolvedValue({});
    upsertFromDiscovery.mockResolvedValue({
      id: 'bbc-1',
      created: true,
      updated: false,
    });
    orchestrator = new BbcDiscoveryOrchestrator(
      unlocker,
      brandBusinessContacts as never,
      prisma as never,
    );
  });

  function okHtml(html: string) {
    return {
      outcome: 'ok' as const,
      html,
      httpStatus: 200,
      bodyLength: html.length,
      zone: 'mcp_unlocker',
      elapsedMs: 5,
      providerFailureKind: null,
    };
  }

  function emptyBody() {
    return {
      outcome: 'empty_body' as const,
      html: '',
      httpStatus: 200,
      bodyLength: 0,
      zone: 'mcp_unlocker',
      elapsedMs: 5,
      providerFailureKind: 'empty_body' as const,
    };
  }

  function httpError(status = 504) {
    return {
      outcome: 'http_error' as const,
      html: '',
      httpStatus: status,
      bodyLength: 0,
      zone: 'mcp_unlocker',
      elapsedMs: 5,
      providerFailureKind: 'http' as const,
    };
  }

  function transportError() {
    return {
      outcome: 'network_error' as const,
      html: '',
      httpStatus: 0,
      bodyLength: 0,
      zone: 'mcp_unlocker',
      elapsedMs: 5,
      providerFailureKind: 'transport' as const,
      errorName: 'TypeError',
      errorMessage: 'fetch failed',
      causeCode: 'ENOTFOUND',
    };
  }

  it('fails the run when Unlocker is not configured', async () => {
    isConfigured.mockReturnValue(false);
    const result = await orchestrator.execute(input);
    expect(result.runStatus).toBe('FAILED');
    expect(result.outcome).toBeNull();
    expect(result.terminalStatusPersisted).toBe(true);
    expect(leadDiscoveryRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        status: LeadDiscoveryStatus.FAILED,
        searchMetadata: expect.anything(),
      }),
    });
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('FAILED INVALID_WEBSITE when no pages can be built', async () => {
    const result = await orchestrator.execute({
      ...input,
      website: '',
      domain: '',
    });
    expect(result.runStatus).toBe('FAILED');
    expect(result.errorMessage).toContain('INVALID_WEBSITE');
    expect(result.searchMetadata).toBeNull();
    expect(result.terminalStatusPersisted).toBe(true);
    expect(fetchHtml).not.toHaveBeenCalled();
    expect(upsertFromDiscovery).not.toHaveBeenCalled();
  });

  it('persists contacts and RESULTS_FOUND when pages return emails', async () => {
    fetchHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        return okHtml('Reach partnerships@brand.com for collabs');
      }
      if (url.endsWith('/collaborations')) {
        return okHtml('Also press@brand.com');
      }
      return okHtml('no mail here');
    });

    const result = await orchestrator.execute(input);

    expect(result.runStatus).toBe('COMPLETED');
    expect(result.outcome).toBe('RESULTS_FOUND');
    expect(result.terminalStatusPersisted).toBe(true);
    expect(result.contactsCreated).toBeGreaterThanOrEqual(1);
    expect(upsertFromDiscovery).toHaveBeenCalled();
    expect(leadDiscoveryRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        status: LeadDiscoveryStatus.COMPLETED,
        searchMetadata: expect.objectContaining({
          schemaVersion: 2,
          providerId: 'bbc-brightdata',
          outcome: 'RESULTS_FOUND',
        }),
      }),
    });
  });

  it('NO_MATCHES when all pages ok but no valid emails', async () => {
    fetchHtml.mockResolvedValue(okHtml('<p>Contact form only</p>'));

    const result = await orchestrator.execute(input);

    expect(result.outcome).toBe('NO_MATCHES');
    expect(result.runStatus).toBe('COMPLETED');
    expect(result.contactsCreated).toBe(0);
    expect(upsertFromDiscovery).not.toHaveBeenCalled();
    expect(result.searchMetadata?.businessContacts.pagesSucceeded).toBe(3);
  });

  it('PROVIDER_FAILURE when empty_body pages and zero contacts', async () => {
    fetchHtml.mockResolvedValue(emptyBody());

    const result = await orchestrator.execute(input);

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.searchMetadata?.providerFailureKind).toBe('empty_body');
    expect(result.searchMetadata?.errorSummary?.code).toBe(
      'BBC_PROVIDER_FAILURE',
    );
    expect(upsertFromDiscovery).not.toHaveBeenCalled();
  });

  it('PROVIDER_FAILURE for transport page outcomes with zero contacts', async () => {
    fetchHtml.mockResolvedValue(transportError());

    const result = await orchestrator.execute(input);

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.searchMetadata?.providerFailureKind).toBe('transport');
    expect(result.runStatus).toBe('COMPLETED');
    expect(result.outcome).not.toBe('NO_MATCHES');
  });

  it('PROVIDER_FAILURE for http page outcomes with zero contacts', async () => {
    fetchHtml.mockResolvedValue(httpError(504));

    const result = await orchestrator.execute(input);

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.searchMetadata?.providerFailureKind).toBe('http');
  });

  it('RESULTS_FOUND with partial page failures still records failures', async () => {
    fetchHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        return okHtml('partnerships@brand.com');
      }
      return emptyBody();
    });

    const result = await orchestrator.execute(input);

    expect(result.outcome).toBe('RESULTS_FOUND');
    expect(result.contactsCreated).toBe(1);
    expect(result.searchMetadata?.businessContacts.pagesFailed).toBeGreaterThan(
      0,
    );
    expect(
      result.searchMetadata?.businessContacts.failureCountsByCategory
        .empty_body,
    ).toBeGreaterThan(0);
  });

  it('mixed ok + empty_body with zero emails is PROVIDER_FAILURE not NO_MATCHES', async () => {
    fetchHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        return okHtml('<p>No email</p>');
      }
      return emptyBody();
    });

    const result = await orchestrator.execute(input);

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.outcome).not.toBe('NO_MATCHES');
  });

  it('passes commercialRelevance from classifier into upsert', async () => {
    fetchHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        return okHtml('partnerships@brand.com');
      }
      return okHtml('none');
    });

    await orchestrator.execute(input);

    expect(upsertFromDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'partnerships@brand.com',
        commercialRelevance: CommercialRelevance.HIGH,
        evidenceSnippet: expect.stringContaining('partnerships@brand.com'),
      }),
    );
  });

  describe('DEF-2 fetchHtml throws', () => {
    it('continues after throw; RESULTS_FOUND when another page yields contacts', async () => {
      fetchHtml.mockImplementation(async (url: string) => {
        if (url.endsWith('/partnerships')) {
          return okHtml('partnerships@brand.com');
        }
        throw new TypeError('fetch failed unexpectedly');
      });

      const result = await orchestrator.execute(input);

      expect(result.runStatus).toBe('COMPLETED');
      expect(result.outcome).toBe('RESULTS_FOUND');
      expect(result.contactsCreated).toBe(1);
      expect(
        result.searchMetadata?.businessContacts.failureCountsByCategory
          .transport,
      ).toBeGreaterThan(0);
      expect(
        result.searchMetadata?.businessContacts.pageResults.some(
          (p) => p.outcome === 'unknown_error',
        ),
      ).toBe(true);
    });

    it('PROVIDER_FAILURE when all fetches throw and no contacts', async () => {
      fetchHtml.mockRejectedValue(new TypeError('boom'));

      const result = await orchestrator.execute(input);

      expect(result.outcome).toBe('PROVIDER_FAILURE');
      expect(result.outcome).not.toBe('NO_MATCHES');
      expect(result.runStatus).toBe('COMPLETED');
      expect(upsertFromDiscovery).not.toHaveBeenCalled();
    });
  });

  describe('DEF-1 persistence failures', () => {
    beforeEach(() => {
      fetchHtml.mockImplementation(async (url: string) => {
        if (url.endsWith('/partnerships')) {
          return okHtml('partnerships@brand.com');
        }
        return okHtml('none');
      });
    });

    it('FAILED when upsertFromDiscovery throws; never COMPLETED/RESULTS_FOUND', async () => {
      upsertFromDiscovery.mockRejectedValue(new Error('upsert boom'));

      const result = await orchestrator.execute(input);

      expect(result.runStatus).toBe('FAILED');
      expect(result.outcome).toBeNull();
      expect(result.errorMessage).toContain('CONTACT_PERSIST_FAILED');
      expect(result.terminalStatusPersisted).toBe(true);
      expect(result.partialContactsMayExist).toBe(false);
      expect(leadDiscoveryRunUpdate).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: LeadDiscoveryStatus.FAILED,
          searchMetadata: expect.anything(),
        }),
      });
      const completedWrites = leadDiscoveryRunUpdate.mock.calls.filter(
        (call) => call[0]?.data?.status === LeadDiscoveryStatus.COMPLETED,
      );
      expect(completedWrites).toHaveLength(0);
    });

    it('marks partialContactsMayExist when upsert fails after a prior success', async () => {
      upsertFromDiscovery
        .mockResolvedValueOnce({
          id: 'bbc-1',
          created: true,
          updated: false,
        })
        .mockRejectedValueOnce(new Error('second upsert boom'));

      fetchHtml.mockImplementation(async (url: string) => {
        if (url.endsWith('/partnerships')) {
          return okHtml('partnerships@brand.com press@brand.com');
        }
        return okHtml('none');
      });

      const result = await orchestrator.execute(input);

      expect(result.runStatus).toBe('FAILED');
      expect(result.outcome).toBeNull();
      expect(result.contactsCreated).toBe(1);
      expect(result.partialContactsMayExist).toBe(true);
      expect(result.errorMessage).toContain('CONTACT_PERSIST_FAILED');
    });

    it('FAILED when COMPLETED run update throws after contacts saved', async () => {
      leadDiscoveryRunUpdate.mockRejectedValueOnce(new Error('completed write boom'));

      const result = await orchestrator.execute(input);

      expect(result.runStatus).toBe('FAILED');
      expect(result.outcome).toBeNull();
      expect(result.errorMessage).toContain('RUN_COMPLETED_PERSIST_FAILED');
      expect(result.partialContactsMayExist).toBe(true);
      expect(result.contactsCreated).toBeGreaterThanOrEqual(1);
      // Second update attempt should be FAILED
      expect(leadDiscoveryRunUpdate).toHaveBeenCalledTimes(2);
      expect(leadDiscoveryRunUpdate.mock.calls[1][0].data.status).toBe(
        LeadDiscoveryStatus.FAILED,
      );
    });

    it('reports terminalStatusPersisted false when FAILED write also fails', async () => {
      upsertFromDiscovery.mockRejectedValue(new Error('upsert boom'));
      leadDiscoveryRunUpdate.mockRejectedValue(new Error('failed write boom'));

      const result = await orchestrator.execute(input);

      expect(result.runStatus).toBe('FAILED');
      expect(result.terminalStatusPersisted).toBe(false);
      expect(result.errorMessage).toContain('CONTACT_PERSIST_FAILED');
      expect(result.errorMessage).toContain('FAILED_STATUS_NOT_PERSISTED');
      expect(result.outcome).toBeNull();
    });
  });
});
