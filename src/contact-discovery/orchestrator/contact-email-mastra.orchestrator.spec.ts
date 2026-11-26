jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import {
  CommercialRelevance,
  ContactChannelSource,
  ContactChannelType,
  LeadDiscoveryStatus,
} from '../../generated/prisma/enums';
import { commercialCoverageTier } from '../../lead-discovery/utils/commercial-relevance.util';
import { CONTACT_EMAIL_VERIFICATION_STATUS } from '../../lead-discovery/utils/contact-email-attribution.util';
import { ContactEmailMastraOrchestrator } from './contact-email-mastra.orchestrator';

describe('ContactEmailMastraOrchestrator', () => {
  const publishContactResearchFindBrandEmails = jest.fn();
  const publishContactResearchFindBrandPeople = jest.fn();
  const waitForAiExecutionResult = jest.fn();
  const upsertFromDiscovery = jest.fn();
  const createChannelsForLead = jest.fn();
  const runUpdate = jest.fn();
  const leadFindFirst = jest.fn();
  const leadCreate = jest.fn();
  const leadUpdate = jest.fn();
  const transaction = jest.fn();
  const influencerFindUnique = jest.fn();
  const agencyDiscoveryExecute = jest.fn();
  const researchEligibleAgencies = jest.fn();
  const researchEligiblePeople = jest.fn();

  const publisher = {
    publishContactResearchFindBrandEmails,
    publishContactResearchFindBrandPeople,
  };
  const resultWait = { waitForAiExecutionResult };
  const brandBusinessContacts = { upsertFromDiscovery };
  const contactChannels = { createChannelsForLead };
  const prisma = {
    leadDiscoveryRun: { update: runUpdate },
    lead: {
      findFirst: leadFindFirst,
      create: leadCreate,
      update: leadUpdate,
    },
    influencer: { findUnique: influencerFindUnique },
    $transaction: transaction,
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'AI_RESEARCH_MAX_SERP_QUERIES') return 3;
      if (key === 'AI_RESEARCH_MAX_PAGES') return 4;
      if (key === 'AI_PEOPLE_MAX_SERP_QUERIES') return 4;
      if (key === 'AI_PEOPLE_MAX_PROFILES') return 5;
      if (key === 'AI_PEOPLE_MAX_BRAND_PAGES') return 6;
      if (key === 'CONTACT_OCR_ENABLED') return false;
      return undefined;
    }),
  };
  const agencyDiscovery = { execute: agencyDiscoveryExecute };
  const agencyContactEmails = { researchEligibleAgencies };
  const agencyContactPeople = {
    researchEligibleAgencies: researchEligiblePeople,
  };

  /** RF-03 v2: a verified nominal email (Saleshandy Tier 1) is what skips 2B. */
  let saleshandyTier1 = false;
  const saleshandyTrace = { enabled: false, validEmails: 0, leadsCreated: 0, leadsUpdated: 0 };
  const saleshandy = {
    enrichByDomain: jest.fn(async () => ({ ...saleshandyTrace })),
    enrichLinkedInLeads: jest.fn(async (_ctx: unknown, trace: unknown) => trace),
    hasTier1: jest.fn(() => saleshandyTier1),
  };

  let orchestrator: ContactEmailMastraOrchestrator;
  /** Controlled monotonic clock for RF-04.1 wait/total assertions. */
  let clockMs: number;
  const clock = { now: () => clockMs };

  const baseInput = {
    runId: 'run-1',
    brandCandidateId: 'b1',
    influencerId: 'i1',
    website: 'https://brand.com',
    domain: 'brand.com',
    brandName: 'Brand',
    niche: 'home',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    saleshandyTier1 = false;
    clockMs = 1_000;
    orchestrator = new ContactEmailMastraOrchestrator(
      publisher as never,
      resultWait as never,
      brandBusinessContacts as never,
      contactChannels as never,
      prisma as never,
      configService as never,
      agencyDiscovery as never,
      agencyContactEmails as never,
      agencyContactPeople as never,
      saleshandy as never,
    );
    orchestrator.clock = clock;
    publishContactResearchFindBrandEmails.mockResolvedValue({
      executionId: 'exec-2a',
      correlationId: 'corr-2a',
    });
    publishContactResearchFindBrandPeople.mockResolvedValue({
      executionId: 'exec-2b',
      correlationId: 'corr-2b',
    });
    researchEligibleAgencies.mockResolvedValue({
      executed: true,
      outcome: 'SKIPPED_NO_ELIGIBLE',
      agenciesInvestigated: 0,
      agenciesSucceeded: 0,
      agenciesFailed: 0,
      emailsFound: 0,
      emailsPersistedCreated: 0,
      emailsPersistedUpdated: 0,
      emailsSkipped: 0,
      emailsPersistFailed: 0,
      agencies: [],
    });
    researchEligiblePeople.mockResolvedValue({
      executed: true,
      peoplePassPolicy: 'ALWAYS',
      outcome: 'SKIPPED_NO_ELIGIBLE',
      agenciesInvestigated: 0,
      agenciesSucceeded: 0,
      agenciesFailed: 0,
      peopleFound: 0,
      contactsPersistedCreated: 0,
      contactsPersistedUpdated: 0,
      contactsSkipped: 0,
      contactsPersistFailed: 0,
      agencies: [],
    });
    runUpdate.mockResolvedValue({});
    upsertFromDiscovery.mockResolvedValue({
      id: 'bbc-1',
      created: true,
      updated: false,
      skipped: false,
    });
    createChannelsForLead.mockResolvedValue(undefined);
    leadFindFirst.mockResolvedValue(null);
    leadCreate.mockResolvedValue({ id: 'lead-1' });
    leadUpdate.mockResolvedValue({ id: 'lead-1' });
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        lead: {
          create: leadCreate,
          update: leadUpdate,
        },
      }),
    );
    influencerFindUnique.mockResolvedValue({
      id: 'i1',
      name: 'Creator One',
      countries: ['ES'],
      niche: 'home',
      subNiche: null,
      niches: ['home'],
      idealBrandProfile: {
        targetSectors: ['home'],
        markets: ['Spain'],
      },
    });
    agencyDiscoveryExecute.mockResolvedValue({
      output: {
        operation: 'DISCOVER_AGENCIES',
        outcome: 'NO_MATCHES',
        candidates: [],
        summary: 'no agencies',
        searchMetadata: {
          schemaVersion: 1,
          serpCalls: 2,
          dedupedHitsCount: 0,
          persistedCount: 0,
          providerId: 'nest-agency-discovery-2c',
        },
      },
      persistedCount: 0,
      queries: ['q'],
    });
  });

  function mockEmailsResult(
    emails: Array<{
      email: string;
      sourceUrl?: string;
      evidenceSnippet?: string;
    }>,
    outcome: 'RESULTS_FOUND' | 'NO_MATCHES' | 'PROVIDER_FAILURE' = 'RESULTS_FOUND',
    durationMs = 4_000,
    extras?: {
      pageSnapshots?: Array<{
        url: string;
        normalizedUrl: string;
        fetchedAt: string;
        content: string;
        truncated: boolean;
        mailtoEmails?: string[];
      }>;
    },
  ) {
    return {
      type: 'CONTACT_RESEARCH' as const,
      status: 'COMPLETED' as const,
      durationMs,
      output: {
        operation: 'FIND_BRAND_EMAILS' as const,
        outcome,
        emails: emails.map((e) => ({
          email: e.email,
          sourceUrl: e.sourceUrl ?? 'https://brand.com/contact',
          evidenceSnippet: e.evidenceSnippet ?? e.email,
        })),
        summary: `${emails.length} email(s)`,
        ...(extras?.pageSnapshots?.length
          ? { pageSnapshots: extras.pageSnapshots }
          : {}),
        trace: {
          queries: ['q1'],
          pages: emails.length
            ? ['https://brand.com/contact']
            : [],
          serpCalls: 1,
          pageCalls: emails.length ? 1 : 0,
        },
      },
    };
  }

  function mockPeopleResult(durationMs = 7_000) {
    return {
      type: 'CONTACT_RESEARCH' as const,
      status: 'COMPLETED' as const,
      durationMs,
      output: {
        operation: 'FIND_BRAND_PEOPLE' as const,
        outcome: 'RESULTS_FOUND' as const,
        people: [
          {
            name: 'Alex Partner',
            title: 'Influencer Marketing Manager',
            linkedinUrl: 'https://www.linkedin.com/in/alex-partner',
            emails: [
              {
                email: 'alex@brand.com',
                sourceUrl: 'https://brand.com/team',
                sourceKind: 'brand_web' as const,
                evidenceSnippet: 'Reach Alex at alex@brand.com',
              },
            ],
          },
        ],
        summary: '1 person',
        trace: {
          queries: ['site:linkedin.com/in "Brand"'],
          linkedinUrlsConsidered: [
            'https://www.linkedin.com/in/alex-partner',
          ],
          profilesScraped: 1,
          serpCalls: 1,
          brandPagesFetched: 2,
        },
      },
    };
  }

  function installWaitSequence(
    results: unknown[],
    waitIncrementMs = 250,
  ) {
    let i = 0;
    waitForAiExecutionResult.mockImplementation(async () => {
      clockMs += waitIncrementMs;
      const next = results[i++];
      if (next instanceof Error) throw next;
      return next;
    });
  }

  function lastTimings() {
    return runUpdate.mock.calls[0][0].data.searchMetadata.timings;
  }

  function expectTrack2BSkipped(reason: string) {
    expect(publishContactResearchFindBrandPeople).not.toHaveBeenCalled();
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeadDiscoveryStatus.COMPLETED,
          searchMetadata: expect.objectContaining({
            tracks: ['2A', '2C'],
            track2BDecision: expect.objectContaining({
              executed: false,
              reason,
            }),
            personLeadsCreated: 0,
            track2C: expect.objectContaining({ executed: true }),
          }),
        }),
      }),
    );
    const meta = runUpdate.mock.calls[0][0].data.searchMetadata;
    expect(meta.operation2B).toBeUndefined();
    expect(meta.executionId2B).toBeUndefined();
  }

  function expectTrack2BExecuted(reason: string) {
    expect(publishContactResearchFindBrandPeople).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          searchMetadata: expect.objectContaining({
            tracks: ['2A', '2B', '2C'],
            operation2B: 'FIND_BRAND_PEOPLE',
            executionId2B: 'exec-2b',
            track2BDecision: expect.objectContaining({
              executed: true,
              reason,
            }),
            track2C: expect.objectContaining({ executed: true }),
          }),
        }),
      }),
    );
  }

  function completedMetadata() {
    const completed = [...runUpdate.mock.calls]
      .reverse()
      .find(
        (call) =>
          call[0]?.data?.status === LeadDiscoveryStatus.COMPLETED ||
          call[0]?.data?.searchMetadata?.track2C != null,
      );
    return completed?.[0]?.data?.searchMetadata;
  }

  describe('RF-03 conditional Track 2B', () => {
    it('1: Tier 1 nominal + HIGH mailbox → 2B omitted', async () => {
      saleshandyTier1 = true;
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );

      const result = await orchestrator.execute(baseInput);

      expect(result.outcome).toBe('RESULTS_FOUND');
      expect(result.contactsCreated).toBe(1);
      expectTrack2BSkipped('TIER1_NOMINAL_FOUND');
    });

    it('2: MEDIUM present → 2B omitted', async () => {
      saleshandyTier1 = true;
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'press@brand.com' }]),
      );

      await orchestrator.execute(baseInput);

      expectTrack2BSkipped('TIER1_NOMINAL_FOUND');
    });

    it('3: HIGH and MEDIUM present → 2B omitted', async () => {
      saleshandyTier1 = true;
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([
          { email: 'partnerships@brand.com' },
          { email: 'marketing@brand.com' },
        ]),
      );

      await orchestrator.execute(baseInput);

      expectTrack2BSkipped('TIER1_NOMINAL_FOUND');
    });

    it('1b: HIGH mailbox without Tier 1 nominal → 2B still executed', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(
          mockEmailsResult([{ email: 'partnerships@brand.com' }]),
        )
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expectTrack2BExecuted('MAILBOX_ONLY_HIGH');
    });

    it('4: only GENERAL → 2B executed', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([{ email: 'info@brand.com' }]))
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expectTrack2BExecuted('INSUFFICIENT_COMMERCIAL_COVERAGE');
      expect(leadCreate).toHaveBeenCalled();
    });

    it('5: only LOW → 2B executed', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(
          mockEmailsResult([{ email: 'support@brand.com' }]),
        )
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expectTrack2BExecuted('INSUFFICIENT_COMMERCIAL_COVERAGE');
    });

    it('6: only OTHER (person-like) → 2B executed', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(
          mockEmailsResult([{ email: 'john.smith@brand.com' }]),
        )
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expectTrack2BExecuted('INSUFFICIENT_COMMERCIAL_COVERAGE');
      const meta = runUpdate.mock.calls[0][0].data.searchMetadata;
      expect(meta.coverage2A.hasHigh).toBe(false);
      expect(meta.coverage2A.hasMedium).toBe(false);
      expect(meta.track2BDecision.hasHigh).toBe(false);
    });

    it('7: no emails → 2B executed', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([], 'NO_MATCHES'))
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expectTrack2BExecuted('NO_COMMERCIAL_EMAILS_FROM_2A');
      expect(upsertFromDiscovery).not.toHaveBeenCalled();
    });

    it('8a: 2A hard-fails → no 2B (terminal FAILED; not coverage)', async () => {
      waitForAiExecutionResult.mockResolvedValue({
        type: 'CONTACT_RESEARCH',
        status: 'FAILED',
        error: { message: 'model down', code: 'AI_PROVIDER_ERROR' },
      });

      const result = await orchestrator.execute({
        ...baseInput,
        runId: 'run-2',
      });

      expect(upsertFromDiscovery).not.toHaveBeenCalled();
      expect(publishContactResearchFindBrandPeople).not.toHaveBeenCalled();
      expect(result.runStatus).toBe('FAILED');
      expect(result.terminalStatusPersisted).toBe(true);
      // 2C.3.1: RF-03 never evaluated; single FAILED write; 2C may still run.
      expect(runUpdate).toHaveBeenCalledTimes(1);
      const meta = runUpdate.mock.calls[0][0].data.searchMetadata;
      expect(meta.track2BDecision).toBeUndefined();
      expect(meta.tracks).toEqual(expect.arrayContaining(['2A']));
      expect(agencyDiscoveryExecute).toHaveBeenCalledTimes(1);
    });

    it('8b: 2A soft PROVIDER_FAILURE with no emails → 2B fallback', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([], 'PROVIDER_FAILURE'))
        .mockResolvedValueOnce(mockPeopleResult());

      const result = await orchestrator.execute(baseInput);

      expectTrack2BExecuted('NO_COMMERCIAL_EMAILS_FROM_2A');
      expect(result.runStatus).toBe('COMPLETED');
      expect(result.outcome).toBe('RESULTS_FOUND');
    });

    it('9: 2B fails → 2A results conserved (GENERAL path)', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([{ email: 'info@brand.com' }]))
        .mockRejectedValueOnce(new Error('people timeout'));

      const result = await orchestrator.execute({
        ...baseInput,
        runId: 'run-3',
      });

      expect(result.runStatus).toBe('COMPLETED');
      expect(result.outcome).toBe('RESULTS_FOUND');
      expect(result.contactsCreated).toBe(1);
      expect(publishContactResearchFindBrandPeople).toHaveBeenCalledTimes(1);
      expect(runUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LeadDiscoveryStatus.COMPLETED,
            searchMetadata: expect.objectContaining({
              tracks: ['2A', '2B', '2C'],
              track2BError: expect.stringContaining('WAIT_PEOPLE_FAILED'),
              personLeadsCreated: 0,
              track2BDecision: expect.objectContaining({
                executed: true,
                reason: 'INSUFFICIENT_COMMERCIAL_COVERAGE',
              }),
            }),
          }),
        }),
      );
    });

    it('10: mixed GENERAL+HIGH → 2B omitted (HIGH wins)', async () => {
      saleshandyTier1 = true;
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([
          { email: 'info@brand.com' },
          { email: 'creators@brand.com' },
        ]),
      );

      await orchestrator.execute(baseInput);

      expectTrack2BSkipped('TIER1_NOMINAL_FOUND');
      expect(upsertFromDiscovery).toHaveBeenCalledTimes(2);
    });

    it('11: RF-01 domain-rejected emails do not count as coverage → 2B runs', async () => {
      upsertFromDiscovery.mockResolvedValue({
        id: null,
        created: false,
        updated: false,
        skipped: true,
        skipReason: 'domain_mismatch',
      });
      waitForAiExecutionResult
        .mockResolvedValueOnce(
          mockEmailsResult([
            {
              email: 'partnerships@other.com',
              sourceUrl: 'https://brand.com/x',
            },
          ]),
        )
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expect(upsertFromDiscovery).toHaveBeenCalled();
      expectTrack2BExecuted('NO_COMMERCIAL_EMAILS_FROM_2A');
      const meta = runUpdate.mock.calls[0][0].data.searchMetadata;
      expect(meta.coverage2A.hasHigh).toBe(false);
      expect(meta.coverage2A.emailsSkippedDomain).toBe(1);
      expect(meta.coverage2A.emailsPersistedCreated).toBe(0);
    });

    it('12: historical BBCs are irrelevant — decision uses this-run upserts only', async () => {
      // Even if brand already had HIGH in DB, we never query historical BBCs.
      // This run only gets GENERAL → 2B must run.
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([{ email: 'hello@brand.com' }]))
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expect(prisma.leadDiscoveryRun.update).toHaveBeenCalled();
      expect(
        Object.keys(prisma).every((k) => k !== 'brandBusinessContact'),
      ).toBe(true);
      expectTrack2BExecuted('INSUFFICIENT_COMMERCIAL_COVERAGE');
    });

    it('does not publish 2B more than once per execution', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([{ email: 'contact@brand.com' }]))
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expect(publishContactResearchFindBrandPeople).toHaveBeenCalledTimes(1);
    });
  });

  describe('RF-01 regression (2B still reached via GENERAL 2A)', () => {
    it('RF-01.1: linkedin dataset info@ is not person-attributed; goes to BBC', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([{ email: 'info@brand.com' }]))
        .mockResolvedValueOnce({
          type: 'CONTACT_RESEARCH',
          status: 'COMPLETED',
          output: {
            operation: 'FIND_BRAND_PEOPLE',
            outcome: 'RESULTS_FOUND',
            people: [
              {
                name: 'Alex Partner',
                title: 'Influencer Marketing Manager',
                linkedinUrl: 'https://www.linkedin.com/in/alex-partner',
                emails: [
                  {
                    email: 'info@brand.com',
                    sourceUrl: 'https://www.linkedin.com/in/alex-partner',
                    sourceKind: 'linkedin',
                    evidenceSnippet: 'dataset field: info@brand.com',
                  },
                ],
              },
            ],
            summary: '1 person',
            trace: {
              queries: [],
              linkedinUrlsConsidered: [
                'https://www.linkedin.com/in/alex-partner',
              ],
              profilesScraped: 1,
              serpCalls: 1,
              brandPagesFetched: 0,
            },
          },
        });

      await orchestrator.execute({
        ...baseInput,
        runId: 'run-rf01-1-li',
      });

      expect(leadCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contactName: 'Alex Partner',
            email: null,
          }),
        }),
      );
      const channelsArg = createChannelsForLead.mock.calls[0][2] as Array<{
        type: string;
        value: string;
      }>;
      expect(channelsArg.some((c) => c.type === 'EMAIL')).toBe(false);
      expect(channelsArg.some((c) => c.type === 'LINKEDIN')).toBe(true);

      const infoBbcCalls = upsertFromDiscovery.mock.calls.filter(
        (call) => call[0]?.email === 'info@brand.com',
      );
      expect(infoBbcCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('RF-01: does not attribute generic brand inbox to LinkedIn person', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([{ email: 'hello@brand.com' }]))
        .mockResolvedValueOnce({
          type: 'CONTACT_RESEARCH',
          status: 'COMPLETED',
          output: {
            operation: 'FIND_BRAND_PEOPLE',
            outcome: 'RESULTS_FOUND',
            people: [
              {
                name: 'Alex Partner',
                title: 'Influencer Marketing Manager',
                linkedinUrl: 'https://www.linkedin.com/in/alex-partner',
                emails: [
                  {
                    email: 'info@brand.com',
                    sourceUrl: 'https://brand.com/contact',
                    sourceKind: 'brand_web',
                    evidenceSnippet: 'Contact us at info@brand.com',
                  },
                ],
              },
            ],
            summary: '1 person',
            trace: {
              queries: [],
              linkedinUrlsConsidered: [
                'https://www.linkedin.com/in/alex-partner',
              ],
              profilesScraped: 1,
              serpCalls: 1,
              brandPagesFetched: 1,
            },
          },
        });

      await orchestrator.execute({
        ...baseInput,
        runId: 'run-rf01',
      });

      expect(leadCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contactName: 'Alex Partner',
            email: null,
          }),
        }),
      );
      const channelsArg = createChannelsForLead.mock.calls[0][2] as Array<{
        type: string;
        value: string;
      }>;
      expect(channelsArg.some((c) => c.type === 'EMAIL')).toBe(false);
      expect(upsertFromDiscovery).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'info@brand.com',
          brandDomain: 'brand.com',
          isGeneric: true,
        }),
      );
    });
  });

  describe('RF-04.1 timings instrumentation', () => {
    it('propagates durationMs for 2A and 2B and measures waits/total', async () => {
      installWaitSequence([
        mockEmailsResult([{ email: 'info@brand.com' }], 'RESULTS_FOUND', 4_321),
        mockPeopleResult(7_654),
      ], 250);

      await orchestrator.execute(baseInput);

      const timings = lastTimings();
      expect(timings).toEqual({
        wait2AMs: 250,
        aiDuration2AMs: 4_321,
        wait2BMs: 250,
        aiDuration2BMs: 7_654,
        totalOrchestratorMs: expect.any(Number),
      });
      expect(timings.totalOrchestratorMs).toBeGreaterThanOrEqual(
        timings.wait2AMs + timings.wait2BMs,
      );
      expect(runUpdate.mock.calls[0][0].data.searchMetadata.pageResults ?? []).toEqual(
        [],
      );
      // no fabricated elapsedMs: 0 placeholders
      expect(
        JSON.stringify(runUpdate.mock.calls[0][0].data.searchMetadata),
      ).not.toContain('"elapsedMs":0');
    });

    it('omits 2B timing fields when RF-03 skips 2B (HIGH)', async () => {
      saleshandyTier1 = true;
      installWaitSequence([
        mockEmailsResult([{ email: 'partnerships@brand.com' }], 'RESULTS_FOUND', 1_111),
      ], 100);

      await orchestrator.execute(baseInput);

      const timings = lastTimings();
      expect(timings.wait2AMs).toBe(100);
      expect(timings.aiDuration2AMs).toBe(1_111);
      expect(timings.wait2BMs).toBeUndefined();
      expect(timings.aiDuration2BMs).toBeUndefined();
      expect(timings.totalOrchestratorMs).toBeGreaterThanOrEqual(100);
      expect(publishContactResearchFindBrandPeople).not.toHaveBeenCalled();
    });

    it('RF-04.1.1: publish 2B fail before wait omits wait2BMs (not 0)', async () => {
      installWaitSequence([
        mockEmailsResult([{ email: 'info@brand.com' }], 'RESULTS_FOUND', 2_222),
      ], 40);
      publishContactResearchFindBrandPeople.mockRejectedValueOnce(
        new Error('redis down'),
      );

      const result = await orchestrator.execute({
        ...baseInput,
        runId: 'run-publish-2b-fail',
      });

      expect(result.runStatus).toBe('COMPLETED');
      expect(result.contactsCreated).toBe(1);
      expect(waitForAiExecutionResult).toHaveBeenCalledTimes(1); // only 2A
      const meta = runUpdate.mock.calls[0][0].data.searchMetadata;
      expect(meta.track2BError).toEqual(
        expect.stringContaining('PUBLISH_PEOPLE_FAILED'),
      );
      expect(meta.tracks).toEqual(['2A', '2B', '2C']);
      expect(meta.timings).toEqual({
        wait2AMs: 40,
        aiDuration2AMs: 2_222,
        totalOrchestratorMs: expect.any(Number),
      });
      expect(meta.timings.wait2BMs).toBeUndefined();
      expect(meta.timings.aiDuration2BMs).toBeUndefined();
      expect(JSON.stringify(meta.timings)).not.toContain('"wait2BMs":0');
    });

    it('represents missing ai duration as null without inventing values', async () => {
      const emails = mockEmailsResult([{ email: 'hello@brand.com' }]);
      delete (emails as { durationMs?: number }).durationMs;
      installWaitSequence([emails, mockPeopleResult(2_000)], 50);

      await orchestrator.execute(baseInput);

      const timings = lastTimings();
      expect(timings.aiDuration2AMs).toBeNull();
      expect(timings.aiDuration2BMs).toBe(2_000);
      expect(timings.wait2AMs).toBe(50);
    });

    it('on 2B wait failure keeps 2A results and records 2B wait + null ai duration', async () => {
      installWaitSequence(
        [
          mockEmailsResult([{ email: 'info@brand.com' }], 'RESULTS_FOUND', 3_000),
          new Error('people timeout'),
        ],
        80,
      );

      const result = await orchestrator.execute({
        ...baseInput,
        runId: 'run-timing-2b-fail',
      });

      expect(result.contactsCreated).toBe(1);
      expect(result.runStatus).toBe('COMPLETED');
      const meta = runUpdate.mock.calls[0][0].data.searchMetadata;
      expect(meta.track2BError).toEqual(
        expect.stringContaining('WAIT_PEOPLE_FAILED'),
      );
      expect(meta.timings).toEqual({
        wait2AMs: 80,
        aiDuration2AMs: 3_000,
        wait2BMs: 80,
        aiDuration2BMs: null,
        totalOrchestratorMs: expect.any(Number),
      });
      expect(meta.coverage2A.hasHigh).toBe(false);
      expect(meta.track2BDecision.executed).toBe(true);
    });

    it('historical-compatible: timings additive; RF-03 decision unchanged', async () => {
      saleshandyTier1 = true;
      installWaitSequence([
        mockEmailsResult([{ email: 'press@brand.com' }], 'RESULTS_FOUND', 900),
      ]);

      await orchestrator.execute(baseInput);

      const meta = runUpdate.mock.calls[0][0].data.searchMetadata;
      expect(meta.track2BDecision).toEqual(
        expect.objectContaining({
          executed: false,
          reason: 'TIER1_NOMINAL_FOUND',
        }),
      );
      expect(meta.coverage2A).toEqual(
        expect.objectContaining({ hasMedium: true, hasHigh: false }),
      );
      expect(meta.timings.aiDuration2AMs).toBe(900);
      expect(meta.timings.wait2BMs).toBeUndefined();
    });
  });

  it('RF-04.3: transfers 2A pageSnapshots to 2B when RF-03 runs 2B', async () => {
    const pageSnapshots = [
      {
        url: 'https://brand.com/contact',
        normalizedUrl: 'https://brand.com/contact',
        fetchedAt: '2026-03-01T12:00:00.000Z',
        content: '<html>contact</html>',
        truncated: false,
        mailtoEmails: ['info@brand.com'],
      },
    ];
    waitForAiExecutionResult
      .mockResolvedValueOnce(
        mockEmailsResult([{ email: 'info@brand.com' }], 'RESULTS_FOUND', 4_000, {
          pageSnapshots,
        }),
      )
      .mockResolvedValueOnce(mockPeopleResult());

    await orchestrator.execute(baseInput);

    expect(publishContactResearchFindBrandPeople).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        pageSnapshots,
      }),
    );
  });

  it('RF-04.3: does not transfer snapshots when RF-03 omits 2B', async () => {
      saleshandyTier1 = true;
    waitForAiExecutionResult.mockResolvedValueOnce(
      mockEmailsResult(
        [{ email: 'press@brand.com' }],
        'RESULTS_FOUND',
        4_000,
        {
          pageSnapshots: [
            {
              url: 'https://brand.com/press',
              normalizedUrl: 'https://brand.com/press',
              fetchedAt: '2026-03-01T12:00:00.000Z',
              content: '<html>press</html>',
              truncated: false,
            },
          ],
        },
      ),
    );

    await orchestrator.execute(baseInput);

    expect(publishContactResearchFindBrandPeople).not.toHaveBeenCalled();
  });

  it('runs 2A→2B when GENERAL and persists BBC + Lead channels', async () => {
    waitForAiExecutionResult
      .mockResolvedValueOnce(mockEmailsResult([{ email: 'info@brand.com' }]))
      .mockResolvedValueOnce(mockPeopleResult());

    const result = await orchestrator.execute(baseInput);

    expect(publishContactResearchFindBrandEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        brandName: 'Brand',
        domain: 'brand.com',
        maxSerpQueries: 3,
        maxPages: 4,
      }),
    );
    expect(publishContactResearchFindBrandPeople).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        maxSerpQueries: 4,
        maxProfilesToScrape: 5,
        maxBrandPages: 6,
        ocrEnabled: false,
      }),
    );
    expect(publishContactResearchFindBrandPeople.mock.calls[0][0].pageSnapshots).toBeUndefined();
    expect(leadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactName: 'Alex Partner',
          profileUrl: 'https://www.linkedin.com/in/alex-partner',
          email: 'alex@brand.com',
        }),
      }),
    );
    expect(createChannelsForLead).toHaveBeenCalledWith(
      expect.anything(),
      'lead-1',
      expect.arrayContaining([
        expect.objectContaining({
          type: ContactChannelType.LINKEDIN,
          value: 'https://www.linkedin.com/in/alex-partner',
          source: ContactChannelSource.LINKEDIN_SCRAPER,
        }),
        expect.objectContaining({
          type: ContactChannelType.EMAIL,
          value: 'alex@brand.com',
          source: ContactChannelSource.PUBLIC_WEB,
        }),
      ]),
    );
    expect(result.runStatus).toBe('COMPLETED');
    expect(result.outcome).toBe('RESULTS_FOUND');
    expect(result.terminalStatusPersisted).toBe(true);
  });

  it('RF-04.3.1 L4: reinjected-style generic brand_web → BBC GENERAL, never VERIFIED', async () => {
    const generics = [
      'info@brand.com',
      'hello@brand.com',
      'contact@brand.com',
    ] as const;
    for (const email of generics) {
      expect(commercialCoverageTier(email)).toBe('GENERAL');
    }

    waitForAiExecutionResult
      .mockResolvedValueOnce(mockEmailsResult([{ email: 'info@brand.com' }]))
      .mockResolvedValueOnce({
        type: 'CONTACT_RESEARCH' as const,
        status: 'COMPLETED' as const,
        durationMs: 1_200,
        output: {
          operation: 'FIND_BRAND_PEOPLE' as const,
          outcome: 'RESULTS_FOUND' as const,
          people: [
            {
              name: 'Alex Partner',
              title: 'Influencer Marketing Manager',
              linkedinUrl: 'https://www.linkedin.com/in/alex-partner',
              emails: generics.map((email) => ({
                email,
                sourceUrl: 'https://brand.com/',
                sourceKind: 'brand_web' as const,
                evidenceSnippet: `Reach Alex at ${email}`,
              })),
            },
          ],
          summary: 'generics only',
          trace: {
            queries: [],
            linkedinUrlsConsidered: [
              'https://www.linkedin.com/in/alex-partner',
            ],
            profilesScraped: 1,
            serpCalls: 1,
            brandPagesFetched: 0,
          },
        },
      });

    await orchestrator.execute(baseInput);

    for (const email of generics) {
      expect(upsertFromDiscovery).toHaveBeenCalledWith(
        expect.objectContaining({
          email,
          isGeneric: true,
          commercialRelevance: CommercialRelevance.UNKNOWN,
        }),
      );
    }
    // No person-attributed EMAIL channel (generics fail RF-01 canAttribute)
    const emailChannels = createChannelsForLead.mock.calls.flatMap(
      (c) => (c[2] as Array<{ type: string; metadata?: { verificationStatus?: string } }>) ?? [],
    ).filter((ch) => ch.type === ContactChannelType.EMAIL);
    expect(emailChannels).toHaveLength(0);
    expect(
      emailChannels.every(
        (ch) =>
          ch.metadata?.verificationStatus !==
          CONTACT_EMAIL_VERIFICATION_STATUS.VERIFIED,
      ),
    ).toBe(true);
  });

  it('RF-04.3.1 M2: concurrent execute() does not cross pageSnapshots between brands', async () => {
    const snapsA = [
      {
        url: 'https://alpha.com/contact',
        normalizedUrl: 'https://alpha.com/contact',
        fetchedAt: '2026-03-01T12:00:00.000Z',
        content: '<html>alpha-only</html>',
        truncated: false,
      },
    ];
    const snapsB = [
      {
        url: 'https://beta.com/contact',
        normalizedUrl: 'https://beta.com/contact',
        fetchedAt: '2026-03-01T12:00:00.000Z',
        content: '<html>beta-only</html>',
        truncated: false,
      },
    ];

    publishContactResearchFindBrandEmails.mockImplementation(
      async (params: { runId: string }) => ({
        executionId: `exec-2a-${params.runId}`,
        correlationId: `corr-2a-${params.runId}`,
      }),
    );
    publishContactResearchFindBrandPeople.mockImplementation(
      async (params: { runId: string }) => ({
        executionId: `exec-2b-${params.runId}`,
        correlationId: `corr-2b-${params.runId}`,
      }),
    );

    waitForAiExecutionResult.mockImplementation(async (executionId: string) => {
      clockMs += 10;
      if (executionId === 'exec-2a-run-alpha') {
        return mockEmailsResult(
          [{ email: 'info@alpha.com' }],
          'RESULTS_FOUND',
          100,
          { pageSnapshots: snapsA },
        );
      }
      if (executionId === 'exec-2a-run-beta') {
        return mockEmailsResult(
          [{ email: 'info@beta.com' }],
          'RESULTS_FOUND',
          100,
          { pageSnapshots: snapsB },
        );
      }
      if (executionId.startsWith('exec-2b-')) {
        return mockPeopleResult(200);
      }
      throw new Error(`unexpected executionId ${executionId}`);
    });

    await Promise.all([
      orchestrator.execute({
        ...baseInput,
        runId: 'run-alpha',
        brandCandidateId: 'b-alpha',
        website: 'https://alpha.com',
        domain: 'alpha.com',
        brandName: 'Alpha',
      }),
      orchestrator.execute({
        ...baseInput,
        runId: 'run-beta',
        brandCandidateId: 'b-beta',
        website: 'https://beta.com',
        domain: 'beta.com',
        brandName: 'Beta',
      }),
    ]);

    expect(publishContactResearchFindBrandPeople).toHaveBeenCalledTimes(2);
    const peoplePubs = publishContactResearchFindBrandPeople.mock.calls.map(
      (c) => c[0],
    );
    const alphaPub = peoplePubs.find((p) => p.runId === 'run-alpha');
    const betaPub = peoplePubs.find((p) => p.runId === 'run-beta');
    expect(alphaPub).toEqual(
      expect.objectContaining({
        runId: 'run-alpha',
        domain: 'alpha.com',
        pageSnapshots: snapsA,
      }),
    );
    expect(betaPub).toEqual(
      expect.objectContaining({
        runId: 'run-beta',
        domain: 'beta.com',
        pageSnapshots: snapsB,
      }),
    );
    expect(alphaPub.pageSnapshots[0].content).toContain('alpha-only');
    expect(betaPub.pageSnapshots[0].content).toContain('beta-only');
    expect(alphaPub.pageSnapshots[0].content).not.toContain('beta-only');
    expect(betaPub.pageSnapshots[0].content).not.toContain('alpha-only');
  });

  describe('2C.3 Agency Discovery always-on integration', () => {
    it('1: HIGH+MEDIUM → 2B skipped, 2C runs', async () => {
      saleshandyTier1 = true;
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([
          { email: 'partnerships@brand.com' },
          { email: 'marketing@brand.com' },
        ]),
      );

      await orchestrator.execute(baseInput);

      expect(agencyDiscoveryExecute).toHaveBeenCalledTimes(1);
      expectTrack2BSkipped('TIER1_NOMINAL_FOUND');
    });

    it('2: GENERAL → 2B and 2C both run', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([{ email: 'info@brand.com' }]))
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expect(agencyDiscoveryExecute).toHaveBeenCalledTimes(1);
      expectTrack2BExecuted('INSUFFICIENT_COMMERCIAL_COVERAGE');
    });

    it('3: no 2A contacts → 2B and 2C both run', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([], 'NO_MATCHES'))
        .mockResolvedValueOnce(mockPeopleResult());

      await orchestrator.execute(baseInput);

      expect(agencyDiscoveryExecute).toHaveBeenCalledTimes(1);
      expectTrack2BExecuted('NO_COMMERCIAL_EMAILS_FROM_2A');
    });

    it('4: HIGH only → 2C runs while 2B omitted', async () => {
      saleshandyTier1 = true;
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );

      await orchestrator.execute(baseInput);

      expect(publishContactResearchFindBrandPeople).not.toHaveBeenCalled();
      expect(agencyDiscoveryExecute).toHaveBeenCalledTimes(1);
      expect(completedMetadata().tracks).toEqual(['2A', '2C']);
    });

    it('5: 2C NO_MATCHES keeps 2A/2B results and COMPLETED', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([{ email: 'info@brand.com' }]))
        .mockResolvedValueOnce(mockPeopleResult());
      agencyDiscoveryExecute.mockResolvedValueOnce({
        output: {
          operation: 'DISCOVER_AGENCIES',
          outcome: 'NO_MATCHES',
          candidates: [],
          searchMetadata: {
            schemaVersion: 1,
            serpCalls: 1,
            dedupedHitsCount: 0,
            persistedCount: 0,
          },
        },
        persistedCount: 0,
        queries: [],
      });

      const result = await orchestrator.execute(baseInput);

      expect(result.runStatus).toBe('COMPLETED');
      expect(result.outcome).toBe('RESULTS_FOUND');
      expect(result.contactsCreated).toBe(1);
      expect(completedMetadata().track2C).toEqual(
        expect.objectContaining({
          executed: true,
          outcome: 'NO_MATCHES',
          persistedCount: 0,
          emailsPass: expect.objectContaining({
            executed: true,
            outcome: 'SKIPPED_NO_ELIGIBLE',
          }),
        }),
      );
      expect(completedMetadata().track2BDecision).toBeDefined();
      expect(completedMetadata().timings).toBeDefined();
    });

    it('6: 2C failure soft-isolates; 2A/2B conserved', async () => {
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );
      agencyDiscoveryExecute.mockRejectedValueOnce(
        new Error('bright data down'),
      );

      const result = await orchestrator.execute(baseInput);

      expect(result.runStatus).toBe('COMPLETED');
      expect(result.outcome).toBe('RESULTS_FOUND');
      expect(result.contactsCreated).toBe(1);
      expect(completedMetadata().track2C).toEqual(
        expect.objectContaining({
          executed: true,
          outcome: 'PROVIDER_FAILURE',
          error: expect.stringContaining('bright data down'),
          candidatesCount: 0,
          persistedCount: 0,
          emailsPass: expect.objectContaining({ executed: true }),
        }),
      );
      expect(completedMetadata().track2C.searchMetadata).toBeUndefined();
      // Discovery failed but emails pass still attempted (eligibility from Prisma).
      expect(researchEligibleAgencies).toHaveBeenCalled();
    });

    it('7: 2A hard-fail still runs 2C then FAILED (single failRun, no invented RF-03)', async () => {
      agencyDiscoveryExecute.mockResolvedValueOnce({
        output: {
          operation: 'DISCOVER_AGENCIES',
          outcome: 'RESULTS_FOUND',
          candidates: [
            {
              agency: {
                name: 'Agency Co',
                domain: 'agency.co',
                agencyType: 'INFLUENCER_MARKETING_AGENCY',
              },
              association: { relevanceStatus: 'UNDER_REVIEW' },
            },
          ],
          searchMetadata: {
            schemaVersion: 1,
            serpCalls: 2,
            dedupedHitsCount: 1,
            persistedCount: 1,
          },
        },
        persistedCount: 1,
        queries: ['q'],
      });
      waitForAiExecutionResult.mockResolvedValue({
        type: 'CONTACT_RESEARCH',
        status: 'FAILED',
        error: { message: 'model down', code: 'AI_PROVIDER_ERROR' },
      });

      const result = await orchestrator.execute({
        ...baseInput,
        runId: 'run-2a-hard-2c',
      });

      expect(result.runStatus).toBe('FAILED');
      expect(publishContactResearchFindBrandPeople).not.toHaveBeenCalled();
      expect(agencyDiscoveryExecute).toHaveBeenCalledTimes(1);
      // 2C.3.1: one terminal FAILED write (no intermediate failRun before 2C).
      expect(runUpdate).toHaveBeenCalledTimes(1);
      expect(runUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LeadDiscoveryStatus.FAILED,
            errorMessage: expect.stringContaining('model down'),
            searchMetadata: expect.objectContaining({
              tracks: ['2A', '2C'],
              operation2C: 'DISCOVER_AGENCIES',
              track2C: expect.objectContaining({
                executed: true,
                outcome: 'RESULTS_FOUND',
                persistedCount: 1,
              }),
            }),
          }),
        }),
      );
      const failMeta = runUpdate.mock.calls[0][0].data.searchMetadata;
      expect(failMeta.track2BDecision).toBeUndefined();
      expect(failMeta.operation2B).toBeUndefined();
      expect(JSON.stringify(failMeta)).not.toContain(
        'NO_COMMERCIAL_EMAILS_FROM_2A',
      );
      expect(result.searchMetadata).toEqual(
        expect.objectContaining({
          tracks: ['2A', '2C'],
          track2C: expect.objectContaining({ outcome: 'RESULTS_FOUND' }),
        }),
      );
    });

    it('8: 2B soft-fail still runs 2C', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([{ email: 'info@brand.com' }]))
        .mockRejectedValueOnce(new Error('people timeout'));

      const result = await orchestrator.execute(baseInput);

      expect(result.runStatus).toBe('COMPLETED');
      expect(agencyDiscoveryExecute).toHaveBeenCalledTimes(1);
      expect(completedMetadata().tracks).toEqual(['2A', '2B', '2C']);
      expect(completedMetadata().track2BError).toEqual(
        expect.stringContaining('WAIT_PEOPLE_FAILED'),
      );
    });

    it('9: 2C invoked once per Lead Discovery execute', async () => {
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );

      await orchestrator.execute(baseInput);

      expect(agencyDiscoveryExecute).toHaveBeenCalledTimes(1);
    });

    it('10: repeating execute calls AgencyDiscovery again (idempotency in persistence)', async () => {
      waitForAiExecutionResult.mockResolvedValue(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );

      await orchestrator.execute({ ...baseInput, runId: 'run-r1' });
      await orchestrator.execute({ ...baseInput, runId: 'run-r2' });

      expect(agencyDiscoveryExecute).toHaveBeenCalledTimes(2);
      expect(agencyDiscoveryExecute.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          operation: 'DISCOVER_AGENCIES',
          influencerId: 'i1',
          influencerName: 'Creator One',
        }),
      );
    });

    it('11: response keeps track2BDecision + timings (RF-03/RF-04)', async () => {
      saleshandyTier1 = true;
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );

      await orchestrator.execute(baseInput);

      const meta = completedMetadata();
      expect(meta.track2BDecision).toEqual(
        expect.objectContaining({
          executed: false,
          reason: 'TIER1_NOMINAL_FOUND',
        }),
      );
      expect(meta.timings).toEqual(
        expect.objectContaining({
          wait2AMs: expect.any(Number),
          totalOrchestratorMs: expect.any(Number),
        }),
      );
      expect(meta.track2C.executed).toBe(true);
    });

    it('12: all tracks provider-failed → PROVIDER_FAILURE (not success)', async () => {
      waitForAiExecutionResult
        .mockResolvedValueOnce(mockEmailsResult([], 'PROVIDER_FAILURE'))
        .mockResolvedValueOnce({
          type: 'CONTACT_RESEARCH',
          status: 'COMPLETED',
          durationMs: 10,
          output: {
            operation: 'FIND_BRAND_PEOPLE',
            outcome: 'PROVIDER_FAILURE',
            people: [],
            summary: 'people provider failed',
            trace: {
              queries: [],
              linkedinUrlsConsidered: [],
              profilesScraped: 0,
              serpCalls: 0,
              brandPagesFetched: 0,
            },
          },
        });
      agencyDiscoveryExecute.mockResolvedValueOnce({
        output: {
          operation: 'DISCOVER_AGENCIES',
          outcome: 'PROVIDER_FAILURE',
          candidates: [],
          searchMetadata: {
            schemaVersion: 1,
            serpCalls: 1,
            providerErrors: ['serp down'],
            persistedCount: 0,
          },
        },
        persistedCount: 0,
        queries: ['q'],
      });

      const result = await orchestrator.execute(baseInput);

      expect(result.runStatus).toBe('COMPLETED');
      expect(result.outcome).toBe('PROVIDER_FAILURE');
      expect(completedMetadata().track2C.outcome).toBe('PROVIDER_FAILURE');
      expect(completedMetadata().tracks).toEqual(['2A', '2B', '2C']);
    });

    it('does not declare 2C executed when influencer context is missing', async () => {
      saleshandyTier1 = true;
      influencerFindUnique.mockResolvedValueOnce(null);
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );

      await orchestrator.execute(baseInput);

      expect(agencyDiscoveryExecute).not.toHaveBeenCalled();
      expect(researchEligibleAgencies).not.toHaveBeenCalled();
      expect(completedMetadata().tracks).toEqual(['2A']);
      expect(completedMetadata().track2C).toEqual({ executed: false });
      expect(completedMetadata().operation2C).toBeUndefined();
    });

    it('19–20: emailsPass RESULTS_FOUND soft-isolates; 2A conserved in track2C', async () => {
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );
      researchEligibleAgencies.mockResolvedValueOnce({
        executed: true,
        outcome: 'RESULTS_FOUND',
        agenciesInvestigated: 1,
        agenciesSucceeded: 1,
        agenciesFailed: 0,
        emailsFound: 1,
        emailsPersistedCreated: 1,
        emailsPersistedUpdated: 0,
        emailsSkipped: 0,
        emailsPersistFailed: 0,
        agencies: [
          {
            agencyId: 'agency-1',
            domain: 'agency.example',
            relevanceStatus: 'RELEVANT',
            outcome: 'RESULTS_FOUND',
            executionId: 'exec-ae',
            emailsFound: 1,
            emailsPersistedCreated: 1,
            emailsPersistedUpdated: 0,
            emailsSkipped: 0,
            emailsPersistFailed: 0,
          },
        ],
      });

      const result = await orchestrator.execute(baseInput);

      expect(result.runStatus).toBe('COMPLETED');
      expect(result.outcome).toBe('RESULTS_FOUND');
      expect(result.contactsCreated).toBe(1);
      expect(researchEligibleAgencies).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-1',
          influencerId: 'i1',
        }),
      );
      expect(completedMetadata().track2C.emailsPass).toEqual(
        expect.objectContaining({
          executed: true,
          outcome: 'RESULTS_FOUND',
          emailsPersistedCreated: 1,
        }),
      );
    });

    it('19: emailsPass PROVIDER_FAILURE does not fail 2A COMPLETED', async () => {
      saleshandyTier1 = true;
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );
      researchEligibleAgencies.mockResolvedValueOnce({
        executed: true,
        outcome: 'PROVIDER_FAILURE',
        error: 'WAIT_TIMEOUT: timed out',
        agenciesInvestigated: 1,
        agenciesSucceeded: 0,
        agenciesFailed: 1,
        emailsFound: 0,
        emailsPersistedCreated: 0,
        emailsPersistedUpdated: 0,
        emailsSkipped: 0,
        emailsPersistFailed: 0,
        agencies: [],
      });

      const result = await orchestrator.execute(baseInput);

      expect(result.runStatus).toBe('COMPLETED');
      expect(result.outcome).toBe('RESULTS_FOUND');
      expect(completedMetadata().track2C.emailsPass.outcome).toBe(
        'PROVIDER_FAILURE',
      );
      expect(completedMetadata().tracks).toEqual(['2A', '2C']);
    });

    it('2C.4.6: peoplePass ALWAYS runs after emailsPass (even PROVIDER_FAILURE)', async () => {
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );
      researchEligibleAgencies.mockResolvedValueOnce({
        executed: true,
        outcome: 'PROVIDER_FAILURE',
        error: 'WAIT_TIMEOUT',
        agenciesInvestigated: 1,
        agenciesSucceeded: 0,
        agenciesFailed: 1,
        emailsFound: 0,
        emailsPersistedCreated: 0,
        emailsPersistedUpdated: 0,
        emailsSkipped: 0,
        emailsPersistFailed: 0,
        agencies: [],
      });
      researchEligiblePeople.mockResolvedValueOnce({
        executed: true,
        peoplePassPolicy: 'ALWAYS',
        outcome: 'RESULTS_FOUND',
        agenciesInvestigated: 1,
        agenciesSucceeded: 1,
        agenciesFailed: 0,
        peopleFound: 1,
        contactsPersistedCreated: 1,
        contactsPersistedUpdated: 0,
        contactsSkipped: 0,
        contactsPersistFailed: 0,
        agencies: [],
      });

      const result = await orchestrator.execute(baseInput);

      expect(result.runStatus).toBe('COMPLETED');
      expect(researchEligiblePeople).toHaveBeenCalledWith(
        expect.objectContaining({
          emailsPass: expect.objectContaining({
            outcome: 'PROVIDER_FAILURE',
          }),
        }),
      );
      expect(completedMetadata().track2C.emailsPass.outcome).toBe(
        'PROVIDER_FAILURE',
      );
      expect(completedMetadata().track2C.peoplePass).toEqual(
        expect.objectContaining({
          peoplePassPolicy: 'ALWAYS',
          outcome: 'RESULTS_FOUND',
          contactsPersistedCreated: 1,
        }),
      );
    });

    it('2C.4.6: peoplePass failure does not erase emailsPass metadata', async () => {
      waitForAiExecutionResult.mockResolvedValueOnce(
        mockEmailsResult([{ email: 'partnerships@brand.com' }]),
      );
      researchEligibleAgencies.mockResolvedValueOnce({
        executed: true,
        outcome: 'RESULTS_FOUND',
        agenciesInvestigated: 1,
        emailsFound: 1,
        emailsPersistedCreated: 1,
        emailsPersistedUpdated: 0,
        emailsSkipped: 0,
        emailsPersistFailed: 0,
        agencies: [],
      });
      researchEligiblePeople.mockRejectedValueOnce(new Error('people boom'));

      await orchestrator.execute(baseInput);

      expect(completedMetadata().track2C.emailsPass.outcome).toBe(
        'RESULTS_FOUND',
      );
      expect(completedMetadata().track2C.emailsPass.emailsPersistedCreated).toBe(
        1,
      );
      expect(completedMetadata().track2C.peoplePass.outcome).toBe(
        'PROVIDER_FAILURE',
      );
      expect(completedMetadata().track2C.peoplePass.error).toMatch(/people boom/);
    });
  });
});
