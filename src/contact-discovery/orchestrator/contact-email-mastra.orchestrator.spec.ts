jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { LeadDiscoveryStatus } from '../../generated/prisma/enums';
import { ContactEmailMastraOrchestrator } from './contact-email-mastra.orchestrator';

describe('ContactEmailMastraOrchestrator', () => {
  const publishContactResearchFindBrandEmails = jest.fn();
  const waitForAiExecutionResult = jest.fn();
  const upsertFromDiscovery = jest.fn();
  const runUpdate = jest.fn();

  const publisher = { publishContactResearchFindBrandEmails };
  const resultWait = { waitForAiExecutionResult };
  const brandBusinessContacts = { upsertFromDiscovery };
  const prisma = {
    leadDiscoveryRun: { update: runUpdate },
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'AI_RESEARCH_MAX_SERP_QUERIES') return 3;
      if (key === 'AI_RESEARCH_MAX_PAGES') return 4;
      return undefined;
    }),
  };

  let orchestrator: ContactEmailMastraOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new ContactEmailMastraOrchestrator(
      publisher as never,
      resultWait as never,
      brandBusinessContacts as never,
      prisma as never,
      configService as never,
    );
    publishContactResearchFindBrandEmails.mockResolvedValue({
      executionId: 'exec-1',
      correlationId: 'corr-1',
    });
    runUpdate.mockResolvedValue({});
    upsertFromDiscovery.mockResolvedValue({
      id: 'bbc-1',
      created: true,
      updated: false,
    });
  });

  it('publishes, waits, upserts emails, marks COMPLETED', async () => {
    waitForAiExecutionResult.mockResolvedValue({
      type: 'CONTACT_RESEARCH',
      status: 'COMPLETED',
      output: {
        operation: 'FIND_BRAND_EMAILS',
        outcome: 'RESULTS_FOUND',
        emails: [
          {
            email: 'partnerships@brand.com',
            sourceUrl: 'https://brand.com/contact',
            evidenceSnippet: 'partnerships@brand.com',
          },
        ],
        summary: '1 email',
        trace: {
          queries: ['q1'],
          pages: ['https://brand.com/contact'],
          serpCalls: 1,
          pageCalls: 1,
        },
      },
    });

    const result = await orchestrator.execute({
      runId: 'run-1',
      brandCandidateId: 'b1',
      influencerId: 'i1',
      website: 'https://brand.com',
      domain: 'brand.com',
      brandName: 'Brand',
      niche: 'home',
    });

    expect(publishContactResearchFindBrandEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        brandName: 'Brand',
        domain: 'brand.com',
        maxSerpQueries: 3,
        maxPages: 4,
      }),
    );
    expect(waitForAiExecutionResult).toHaveBeenCalledWith(
      'exec-1',
      expect.any(Number),
    );
    expect(upsertFromDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        brandCandidateId: 'b1',
        email: 'partnerships@brand.com',
        sourceUrl: 'https://brand.com/contact',
      }),
    );
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: LeadDiscoveryStatus.COMPLETED,
        }),
      }),
    );
    expect(result.runStatus).toBe('COMPLETED');
    expect(result.outcome).toBe('RESULTS_FOUND');
    expect(result.contactsCreated).toBe(1);
    expect(result.terminalStatusPersisted).toBe(true);
  });

  it('marks FAILED when AI result is FAILED', async () => {
    waitForAiExecutionResult.mockResolvedValue({
      type: 'CONTACT_RESEARCH',
      status: 'FAILED',
      error: { message: 'model down', code: 'AI_PROVIDER_ERROR' },
    });

    const result = await orchestrator.execute({
      runId: 'run-2',
      brandCandidateId: 'b1',
      influencerId: 'i1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(upsertFromDiscovery).not.toHaveBeenCalled();
    expect(result.runStatus).toBe('FAILED');
    expect(result.terminalStatusPersisted).toBe(true);
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeadDiscoveryStatus.FAILED,
        }),
      }),
    );
  });
});
