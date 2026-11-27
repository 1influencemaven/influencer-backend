jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AgencyRelevanceStatus } from '../generated/prisma/enums';
import { AiExecutionWaitError } from '../ai-execution/ai-execution-result-wait.errors';
import {
  AGENCY_CONTACT_EMAILS_MAX_AGENCIES_PER_RUN,
  AGENCY_CONTACT_EMAILS_TIMEOUT_MS,
  AgencyContactEmailsResearchService,
} from './agency-contact-emails-research.service';

describe('AgencyContactEmailsResearchService (2C.4.5)', () => {
  const influencerAgencyFindMany = jest.fn();
  const publishContactResearchFindAgencyEmails = jest.fn();
  const waitForAiExecutionResult = jest.fn();
  const upsertFromDiscovery = jest.fn();

  const prisma = {
    influencerAgency: { findMany: influencerAgencyFindMany },
  };
  const publisher = {
    publishContactResearchFindAgencyEmails,
  };
  const resultWait = { waitForAiExecutionResult };
  const agencyContacts = { upsertFromDiscovery };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'AI_AGENCY_EMAILS_MAX_AGENCIES') return 5;
      if (key === 'AI_RESEARCH_MAX_SERP_QUERIES') return 3;
      if (key === 'AI_RESEARCH_MAX_PAGES') return 4;
      return undefined;
    }),
  };

  let service: AgencyContactEmailsResearchService;

  const eligibleRow = (
    overrides?: Partial<{
      relevanceStatus: AgencyRelevanceStatus;
      evidenceUrls: string[];
      agency: {
        id: string;
        name: string;
        website: string | null;
        domain: string;
      };
    }>,
  ) => ({
    relevanceStatus: AgencyRelevanceStatus.UNDER_REVIEW,
    evidenceUrls: ['https://creatorpartners.example/contact'],
    agency: {
      id: 'agency-1',
      name: 'Creator Partners',
      website: 'https://creatorpartners.example',
      domain: 'creatorpartners.example',
    },
    ...overrides,
  });

  function mastraEmailsResult(
    emails: Array<{
      email: string;
      sourceUrl: string;
      evidenceSnippet?: string;
      sourceKind?: 'agency_web';
      commercialRelevance?: 'HIGH' | 'NEUTRAL' | 'LOW' | 'UNKNOWN';
      outreachRole?: string;
      isGeneric?: boolean;
      provenance?: {
        discoveryStatus: 'FOUND';
        attributionStatus: 'ATTRIBUTED';
        verificationStatus: 'UNVERIFIED';
      };
    }>,
    outcome: 'RESULTS_FOUND' | 'NO_MATCHES' | 'PROVIDER_FAILURE' = 'RESULTS_FOUND',
  ) {
    return {
      type: 'CONTACT_RESEARCH' as const,
      status: 'COMPLETED' as const,
      durationMs: 12,
      output: {
        operation: 'FIND_AGENCY_EMAILS' as const,
        outcome,
        emails: emails.map((e) => ({
          sourceKind: 'agency_web' as const,
          provenance: {
            discoveryStatus: 'FOUND' as const,
            attributionStatus: 'ATTRIBUTED' as const,
            verificationStatus: 'UNVERIFIED' as const,
          },
          ...e,
        })),
        summary: outcome,
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AgencyContactEmailsResearchService(
      prisma as never,
      publisher as never,
      resultWait as never,
      agencyContacts as never,
      configService as never,
    );
    publishContactResearchFindAgencyEmails.mockResolvedValue({
      executionId: 'exec-agency-1',
      correlationId: 'corr-agency-1',
    });
    upsertFromDiscovery.mockResolvedValue({
      id: 'ac-1',
      created: true,
      updated: false,
      skipped: false,
    });
  });

  it('1: publishes FIND_AGENCY_EMAILS with agency identity + seeds', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(mastraEmailsResult([]));

    await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
      userId: 'user-1',
      niche: 'home',
    });

    expect(publishContactResearchFindAgencyEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        influencerId: 'inf-1',
        agencyId: 'agency-1',
        agencyName: 'Creator Partners',
        website: 'https://creatorpartners.example',
        domain: 'creatorpartners.example',
        niche: 'home',
        maxSerpQueries: 3,
        maxPages: 4,
        seedUrls: ['https://creatorpartners.example/contact'],
      }),
    );
    expect(influencerAgencyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          influencerId: 'inf-1',
          relevanceStatus: {
            in: [
              AgencyRelevanceStatus.RELEVANT,
              AgencyRelevanceStatus.UNDER_REVIEW,
            ],
          },
        },
      }),
    );
  });

  it('2–3: waits and validates contractual output before persist', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(
      mastraEmailsResult([
        {
          email: 'partnerships@creatorpartners.example',
          sourceUrl: 'https://creatorpartners.example/contact',
          evidenceSnippet: 'partnerships@creatorpartners.example',
          commercialRelevance: 'HIGH',
          outreachRole: 'Partnerships',
          isGeneric: true,
        },
      ]),
    );

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(waitForAiExecutionResult).toHaveBeenCalledWith(
      'exec-agency-1',
      expect.any(Number),
    );
    expect(upsertFromDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        influencerId: 'inf-1',
        agencyId: 'agency-1',
        agencyDomain: 'creatorpartners.example',
        email: 'partnerships@creatorpartners.example',
        sourceUrl: 'https://creatorpartners.example/contact',
        evidenceSnippet: 'partnerships@creatorpartners.example',
        sourceKind: 'agency_web',
        outreachRole: 'Partnerships',
        isGeneric: true,
      }),
    );
    expect(result.outcome).toBe('RESULTS_FOUND');
    expect(result.emailsPersistedCreated).toBe(1);
    expect(result.agencies?.[0]?.executionId).toBe('exec-agency-1');
  });

  it('5–7: idempotent persist + conserves sourceKind agency_web + provenance fields', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(
      mastraEmailsResult([
        {
          email: 'collab@creatorpartners.example',
          sourceUrl: 'https://creatorpartners.example/collab',
          evidenceSnippet: 'collab@',
          commercialRelevance: 'HIGH',
        },
      ]),
    );
    upsertFromDiscovery
      .mockResolvedValueOnce({
        id: 'ac-1',
        created: true,
        updated: false,
        skipped: false,
      })
      .mockResolvedValueOnce({
        id: 'ac-1',
        created: false,
        updated: true,
        skipped: false,
      });

    const first = await service.researchEligibleAgencies({
      runId: 'run-a',
      influencerId: 'inf-1',
    });
    const second = await service.researchEligibleAgencies({
      runId: 'run-b',
      influencerId: 'inf-1',
    });

    expect(first.emailsPersistedCreated).toBe(1);
    expect(second.emailsPersistedUpdated).toBe(1);
    expect(upsertFromDiscovery.mock.calls[0][0].sourceKind).toBe('agency_web');
    expect(upsertFromDiscovery.mock.calls[1][0].sourceKind).toBe('agency_web');
    expect(upsertFromDiscovery.mock.calls[0][0].evidenceSnippet).toBe('collab@');
  });

  it('8–9: RELEVANT and UNDER_REVIEW are investigated', async () => {
    influencerAgencyFindMany.mockResolvedValue([
      eligibleRow({
        relevanceStatus: AgencyRelevanceStatus.RELEVANT,
        agency: {
          id: 'a-rel',
          name: 'Rel',
          website: 'https://rel.example',
          domain: 'rel.example',
        },
      }),
      eligibleRow({
        relevanceStatus: AgencyRelevanceStatus.UNDER_REVIEW,
        agency: {
          id: 'a-ur',
          name: 'UR',
          website: 'https://ur.example',
          domain: 'ur.example',
        },
      }),
    ]);
    waitForAiExecutionResult.mockResolvedValue(mastraEmailsResult([]));

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(publishContactResearchFindAgencyEmails).toHaveBeenCalledTimes(2);
    expect(result.agenciesInvestigated).toBe(2);
  });

  it('10–12: NOT_RELEVANT / DISCARDED / missing association excluded by query', async () => {
    influencerAgencyFindMany.mockResolvedValue([]);

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        executed: true,
        outcome: 'SKIPPED_NO_ELIGIBLE',
        agenciesInvestigated: 0,
      }),
    );
    expect(publishContactResearchFindAgencyEmails).not.toHaveBeenCalled();
    expect(influencerAgencyFindMany.mock.calls[0][0].where.relevanceStatus.in).toEqual(
      [AgencyRelevanceStatus.RELEVANT, AgencyRelevanceStatus.UNDER_REVIEW],
    );
  });

  it('13: successful Mastra NO_MATCHES → NO_MATCHES (not failure)', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(
      mastraEmailsResult([], 'NO_MATCHES'),
    );

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result.outcome).toBe('NO_MATCHES');
    expect(result.agencies?.[0]?.outcome).toBe('NO_MATCHES');
    expect(upsertFromDiscovery).not.toHaveBeenCalled();
  });

  it('14: Mastra wait timeout → WAIT_FAILED / PROVIDER_FAILURE aggregate', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockRejectedValue(
      new AiExecutionWaitError('WAIT_TIMEOUT', 'timed out'),
    );

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.agencies?.[0]?.outcome).toBe('WAIT_FAILED');
    expect(result.agencies?.[0]?.error).toMatch(/WAIT_TIMEOUT/);
    expect(upsertFromDiscovery).not.toHaveBeenCalled();
  });

  it('15: publish error → PUBLISH_FAILED', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    publishContactResearchFindAgencyEmails.mockRejectedValue(
      new Error('redis down'),
    );

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.agencies?.[0]?.outcome).toBe('PUBLISH_FAILED');
    expect(result.agencies?.[0]?.error).toMatch(/redis down/);
  });

  it('16: Mastra FAILED status → PROVIDER_FAILURE', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue({
      type: 'CONTACT_RESEARCH',
      status: 'FAILED',
      error: { message: 'model down', code: 'AI_PROVIDER_ERROR' },
    });

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result.agencies?.[0]?.outcome).toBe('PROVIDER_FAILURE');
    expect(result.agencies?.[0]?.error).toMatch(/model down/);
  });

  it('17: invalid output (wrong operation) → INVALID_OUTPUT', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue({
      type: 'CONTACT_RESEARCH',
      status: 'COMPLETED',
      output: {
        operation: 'FIND_BRAND_EMAILS',
        outcome: 'NO_MATCHES',
        emails: [],
      },
    });

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result.agencies?.[0]?.outcome).toBe('INVALID_OUTPUT');
    expect(upsertFromDiscovery).not.toHaveBeenCalled();
  });

  it('18: one persist fail keeps other emails; aggregate PARTIAL', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(
      mastraEmailsResult([
        {
          email: 'ok@creatorpartners.example',
          sourceUrl: 'https://creatorpartners.example/a',
        },
        {
          email: 'bad@creatorpartners.example',
          sourceUrl: 'https://creatorpartners.example/b',
        },
      ]),
    );
    upsertFromDiscovery
      .mockResolvedValueOnce({
        id: 'ac-ok',
        created: true,
        updated: false,
        skipped: false,
      })
      .mockRejectedValueOnce(new Error('db write failed'));

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result.emailsPersistedCreated).toBe(1);
    expect(result.emailsPersistFailed).toBe(1);
    expect(result.outcome).toBe('PARTIAL');
    expect(result.agencies?.[0]?.error).toMatch(/PARTIAL_PERSIST/);
  });

  it('does not invent sourceKind when Mastra omits it (schema default → persist agency_web)', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue({
      type: 'CONTACT_RESEARCH',
      status: 'COMPLETED',
      output: {
        operation: 'FIND_AGENCY_EMAILS',
        outcome: 'RESULTS_FOUND',
        emails: [
          {
            email: 'info@creatorpartners.example',
            sourceUrl: 'https://creatorpartners.example/contact',
            evidenceSnippet: 'info@',
            // sourceKind omitted — Zod default agency_web on contract parse
          },
        ],
      },
    });

    await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(upsertFromDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: 'agency_web' }),
    );
  });

  it('skips email when sourceKind is not agency_web after parse', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    // Force a payload that passes outer operation but fails literal if we injected wrong kind
    // via safeParse — brand_web is rejected by schema, so INVALID_OUTPUT at agency level.
    waitForAiExecutionResult.mockResolvedValue({
      type: 'CONTACT_RESEARCH',
      status: 'COMPLETED',
      output: {
        operation: 'FIND_AGENCY_EMAILS',
        outcome: 'RESULTS_FOUND',
        emails: [
          {
            email: 'x@creatorpartners.example',
            sourceUrl: 'https://creatorpartners.example/x',
            sourceKind: 'linkedin',
          },
        ],
      },
    });

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result.agencies?.[0]?.outcome).toBe('INVALID_OUTPUT');
    expect(upsertFromDiscovery).not.toHaveBeenCalled();
  });

  describe('closure review — timeout / partial persist / sourceKind', () => {
    it('timeout is 300s per agency wait; default max agencies is 5 (≤1500s wait budget)', () => {
      expect(AGENCY_CONTACT_EMAILS_TIMEOUT_MS).toBe(300_000);
      expect(AGENCY_CONTACT_EMAILS_MAX_AGENCIES_PER_RUN).toBe(5);
      expect(
        AGENCY_CONTACT_EMAILS_TIMEOUT_MS *
          AGENCY_CONTACT_EMAILS_MAX_AGENCIES_PER_RUN,
      ).toBe(1_500_000);
    });

    it('wait uses per-agency 300s timeout (not a shared global deadline)', async () => {
      influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
      waitForAiExecutionResult.mockResolvedValue(mastraEmailsResult([]));

      await service.researchEligibleAgencies({
        runId: 'run-1',
        influencerId: 'inf-1',
      });

      expect(waitForAiExecutionResult).toHaveBeenCalledWith(
        'exec-agency-1',
        AGENCY_CONTACT_EMAILS_TIMEOUT_MS,
      );
    });

    it('agency WAIT_FAILED records error and continues to the next agency', async () => {
      influencerAgencyFindMany.mockResolvedValue([
        eligibleRow({
          agency: {
            id: 'agency-fail',
            name: 'Fail Co',
            website: 'https://fail.example',
            domain: 'fail.example',
          },
        }),
        eligibleRow({
          agency: {
            id: 'agency-ok',
            name: 'Ok Co',
            website: 'https://ok.example',
            domain: 'ok.example',
          },
          evidenceUrls: [],
        }),
      ]);
      publishContactResearchFindAgencyEmails
        .mockResolvedValueOnce({
          executionId: 'exec-fail',
          correlationId: 'c1',
        })
        .mockResolvedValueOnce({
          executionId: 'exec-ok',
          correlationId: 'c2',
        });
      waitForAiExecutionResult
        .mockRejectedValueOnce(
          new AiExecutionWaitError('WAIT_TIMEOUT', 'agency 1 timed out'),
        )
        .mockResolvedValueOnce(
          mastraEmailsResult([
            {
              email: 'partnerships@ok.example',
              sourceUrl: 'https://ok.example/contact',
              sourceKind: 'agency_web',
            },
          ]),
        );

      const result = await service.researchEligibleAgencies({
        runId: 'run-1',
        influencerId: 'inf-1',
      });

      expect(publishContactResearchFindAgencyEmails).toHaveBeenCalledTimes(2);
      expect(result.agencies?.[0]).toEqual(
        expect.objectContaining({
          agencyId: 'agency-fail',
          outcome: 'WAIT_FAILED',
          executionId: 'exec-fail',
          error: expect.stringContaining('WAIT_TIMEOUT'),
        }),
      );
      expect(result.agencies?.[1]).toEqual(
        expect.objectContaining({
          agencyId: 'agency-ok',
          outcome: 'RESULTS_FOUND',
          emailsPersistedCreated: 1,
        }),
      );
      expect(result.outcome).toBe('PARTIAL');
      expect(result.emailsPersistedCreated).toBe(1);
    });

    it('persist fail then success: first failure counted; second email still persisted', async () => {
      influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
      waitForAiExecutionResult.mockResolvedValue(
        mastraEmailsResult([
          {
            email: 'first@creatorpartners.example',
            sourceUrl: 'https://creatorpartners.example/a',
          },
          {
            email: 'second@creatorpartners.example',
            sourceUrl: 'https://creatorpartners.example/b',
          },
        ]),
      );
      upsertFromDiscovery
        .mockRejectedValueOnce(new Error('transient db'))
        .mockResolvedValueOnce({
          id: 'ac-2',
          created: true,
          updated: false,
          skipped: false,
        });

      const result = await service.researchEligibleAgencies({
        runId: 'run-1',
        influencerId: 'inf-1',
      });

      expect(upsertFromDiscovery).toHaveBeenCalledTimes(2);
      expect(result.emailsPersistFailed).toBe(1);
      expect(result.emailsPersistedCreated).toBe(1);
      expect(result.outcome).toBe('PARTIAL');
      expect(result.outcome).not.toBe('RESULTS_FOUND');
    });

    it('all emails persist-fail → not aggregate RESULTS_FOUND (PARTIAL)', async () => {
      influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
      waitForAiExecutionResult.mockResolvedValue(
        mastraEmailsResult([
          {
            email: 'a@creatorpartners.example',
            sourceUrl: 'https://creatorpartners.example/a',
          },
          {
            email: 'b@creatorpartners.example',
            sourceUrl: 'https://creatorpartners.example/b',
          },
        ]),
      );
      upsertFromDiscovery.mockRejectedValue(new Error('db down'));

      const result = await service.researchEligibleAgencies({
        runId: 'run-1',
        influencerId: 'inf-1',
      });

      expect(result.emailsPersistedCreated).toBe(0);
      expect(result.emailsPersistFailed).toBe(2);
      expect(result.outcome).toBe('PARTIAL');
      expect(result.outcome).not.toBe('RESULTS_FOUND');
      expect(result.agencies?.[0]?.error).toMatch(/PARTIAL_PERSIST/);
    });

    it('Nest persists the validated Mastra sourceKind (pass-through, not invented)', async () => {
      influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
      waitForAiExecutionResult.mockResolvedValue({
        type: 'CONTACT_RESEARCH',
        status: 'COMPLETED',
        output: {
          operation: 'FIND_AGENCY_EMAILS',
          outcome: 'RESULTS_FOUND',
          emails: [
            {
              email: 'talent@creatorpartners.example',
              sourceUrl: 'https://creatorpartners.example/talent',
              evidenceSnippet: 'talent@creatorpartners.example',
              sourceKind: 'agency_web',
              provenance: {
                discoveryStatus: 'FOUND',
                attributionStatus: 'ATTRIBUTED',
                verificationStatus: 'UNVERIFIED',
              },
            },
          ],
        },
      });

      await service.researchEligibleAgencies({
        runId: 'run-1',
        influencerId: 'inf-1',
      });

      const persistArg = upsertFromDiscovery.mock.calls[0][0];
      expect(persistArg.sourceKind).toBe('agency_web');
      // Must be the contractual field value, not a Nest hardcode path inventing another kind.
      expect(Object.keys(persistArg)).toEqual(
        expect.arrayContaining([
          'sourceKind',
          'email',
          'sourceUrl',
          'evidenceSnippet',
        ]),
      );
    });

    it('forwards promptInstructions to publishContactResearchFindAgencyEmails and falls back to AiPromptsService', async () => {
      influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
      waitForAiExecutionResult.mockResolvedValue(mastraEmailsResult([]));

      await service.researchEligibleAgencies({
        runId: 'run-1',
        influencerId: 'inf-1',
        promptInstructions: 'Agency email custom guidance',
      });

      expect(publishContactResearchFindAgencyEmails).toHaveBeenCalledWith(
        expect.objectContaining({
          promptInstructions: 'Agency email custom guidance',
        }),
      );

      const getLeadDiscoveryInstructions = jest
        .fn()
        .mockResolvedValue('Fallback agency prompt from settings');
      const svcWithPrompts = new AgencyContactEmailsResearchService(
        prisma as never,
        publisher as never,
        resultWait as never,
        agencyContacts as never,
        configService as never,
        { getLeadDiscoveryInstructions } as never,
      );

      await svcWithPrompts.researchEligibleAgencies({
        runId: 'run-2',
        influencerId: 'inf-1',
      });

      expect(getLeadDiscoveryInstructions).toHaveBeenCalledTimes(1);
      expect(publishContactResearchFindAgencyEmails).toHaveBeenLastCalledWith(
        expect.objectContaining({
          promptInstructions: 'Fallback agency prompt from settings',
        }),
      );
    });
  });
});
