jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AgencyRelevanceStatus } from '../generated/prisma/enums';
import { AiExecutionWaitError } from '../ai-execution/ai-execution-result-wait.errors';
import { AgencyContactPeopleResearchService } from './agency-contact-people-research.service';

describe('AgencyContactPeopleResearchService (2C.4.6)', () => {
  const influencerAgencyFindMany = jest.fn();
  const publishContactResearchFindAgencyPeople = jest.fn();
  const waitForAiExecutionResult = jest.fn();
  const upsertFromDiscovery = jest.fn();

  const prisma = {
    influencerAgency: { findMany: influencerAgencyFindMany },
  };
  const publisher = { publishContactResearchFindAgencyPeople };
  const resultWait = { waitForAiExecutionResult };
  const agencyContacts = { upsertFromDiscovery };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'AI_AGENCY_PEOPLE_MAX_AGENCIES') return 5;
      if (key === 'AI_PEOPLE_MAX_SERP_QUERIES') return 2;
      if (key === 'AI_PEOPLE_MAX_PROFILES') return 2;
      if (key === 'AI_PEOPLE_MAX_BRAND_PAGES') return 2;
      if (key === 'CONTACT_OCR_ENABLED') return false;
      return undefined;
    }),
  };

  let service: AgencyContactPeopleResearchService;

  const eligibleRow = () => ({
    relevanceStatus: AgencyRelevanceStatus.RELEVANT,
    agency: {
      id: 'agency-1',
      name: 'Creator Partners',
      website: 'https://creatorpartners.example',
      domain: 'creatorpartners.example',
    },
  });

  function mastraPeopleResult(
    people: Array<{
      name: string;
      title?: string;
      linkedinUrl: string;
      emails: Array<{
        email: string;
        sourceUrl: string;
        sourceKind: 'linkedin' | 'agency_web' | 'ocr';
        evidenceSnippet?: string;
      }>;
    }>,
    outcome: 'RESULTS_FOUND' | 'NO_MATCHES' | 'PROVIDER_FAILURE' = 'RESULTS_FOUND',
  ) {
    return {
      type: 'CONTACT_RESEARCH' as const,
      status: 'COMPLETED' as const,
      output: {
        operation: 'FIND_AGENCY_PEOPLE' as const,
        outcome,
        people,
        summary: outcome,
        trace: {
          queries: ['q'],
          linkedinUrlsConsidered: people.map((p) => p.linkedinUrl),
          profilesScraped: people.length,
          serpCalls: 1,
          agencyPagesFetched: 0,
          peeReuse: {
            snapshotsReceivedFromEmailsPass: 1,
            peePagesReused: 1,
            peePagesFetchedUnlocker: 0,
            peePagesRejected: 0,
            unlockerCallsAvoided: 1,
          },
        },
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AgencyContactPeopleResearchService(
      prisma as never,
      publisher as never,
      resultWait as never,
      agencyContacts as never,
      configService as never,
    );
    publishContactResearchFindAgencyPeople.mockResolvedValue({
      executionId: 'exec-people-1',
      correlationId: 'corr-p',
    });
    upsertFromDiscovery.mockResolvedValue({
      id: 'ac-p1',
      created: true,
      updated: false,
      skipped: false,
    });
  });

  it.each([
    'RESULTS_FOUND',
    'NO_MATCHES',
    'PARTIAL',
    'PROVIDER_FAILURE',
  ] as const)('ALWAYS: runs when emailsPass.outcome=%s', async (emailsOutcome) => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(mastraPeopleResult([]));

    await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
      emailsPass: {
        executed: true,
        outcome: emailsOutcome,
        agenciesInvestigated: 1,
        agencies: [],
      },
    });

    expect(publishContactResearchFindAgencyPeople).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyId: 'agency-1',
        agencyName: 'Creator Partners',
      }),
    );
  });

  it('UNDER_REVIEW associations are eligible', async () => {
    influencerAgencyFindMany.mockResolvedValue([
      {
        ...eligibleRow(),
        relevanceStatus: AgencyRelevanceStatus.UNDER_REVIEW,
      },
    ]);
    waitForAiExecutionResult.mockResolvedValue(mastraPeopleResult([]));

    await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(publishContactResearchFindAgencyPeople).toHaveBeenCalled();
  });

  it('conserves ocr sourceKind on PERSON persist', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(
      mastraPeopleResult([
        {
          name: 'Sam Talent',
          title: 'Creator Relations',
          linkedinUrl: 'https://www.linkedin.com/in/sam-talent',
          emails: [
            {
              email: 'sam@creatorpartners.example',
              sourceUrl: 'https://creatorpartners.example/card.png',
              sourceKind: 'ocr',
              evidenceSnippet: 'Sam Talent sam@creatorpartners.example',
            },
          ],
        },
      ]),
    );

    await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(upsertFromDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        contactKind: 'PERSON',
        sourceKind: 'ocr',
        email: 'sam@creatorpartners.example',
        displayName: 'Sam Talent',
      }),
    );
  });

  it('forwards same-run pageSnapshots from emailsPass for the agency', async () => {
    const snap = {
      url: 'https://creatorpartners.example/team',
      normalizedUrl: 'https://creatorpartners.example/team',
      fetchedAt: new Date().toISOString(),
      content: '<html>team</html>',
      truncated: false,
    };
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(mastraPeopleResult([]));

    await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
      emailsPass: {
        executed: true,
        outcome: 'NO_MATCHES',
        agencies: [
          {
            agencyId: 'agency-1',
            domain: 'creatorpartners.example',
            relevanceStatus: 'RELEVANT',
            outcome: 'NO_MATCHES',
            emailsFound: 0,
            emailsPersistedCreated: 0,
            emailsPersistedUpdated: 0,
            emailsSkipped: 0,
            emailsPersistFailed: 0,
            pageSnapshots: [snap],
          },
        ],
      },
    });

    expect(publishContactResearchFindAgencyPeople.mock.calls[0][0].pageSnapshots).toEqual(
      [snap],
    );
  });

  it('persists PERSON only when email is attributable; conserves sourceKind', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(
      mastraPeopleResult([
        {
          name: 'Alex Partner',
          title: 'Influencer Marketing',
          linkedinUrl: 'https://www.linkedin.com/in/alex-partner',
          emails: [
            {
              email: 'alex@creatorpartners.example',
              sourceUrl: 'https://www.linkedin.com/in/alex-partner',
              sourceKind: 'linkedin',
              evidenceSnippet: 'alex@creatorpartners.example',
            },
            {
              email: 'partnerships@creatorpartners.example',
              sourceUrl: 'https://creatorpartners.example/team',
              sourceKind: 'agency_web',
              evidenceSnippet: 'Alex Partner partnerships@',
            },
          ],
        },
      ]),
    );

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(upsertFromDiscovery).toHaveBeenCalledTimes(1);
    expect(upsertFromDiscovery.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        contactKind: 'PERSON',
        displayName: 'Alex Partner',
        sourceKind: 'linkedin',
        email: 'alex@creatorpartners.example',
      }),
    );
    expect(result.outcome).toBe('RESULTS_FOUND');
    expect(result.peoplePassPolicy).toBe('ALWAYS');
    expect(result.contactsPersistedCreated).toBe(1);
  });

  it('does not create PERSON from non-attributable agency_web generic', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(
      mastraPeopleResult([
        {
          name: 'Pat Partner',
          linkedinUrl: 'https://www.linkedin.com/in/pat',
          emails: [
            {
              email: 'partnerships@creatorpartners.example',
              sourceUrl: 'https://creatorpartners.example/team',
              sourceKind: 'agency_web',
              evidenceSnippet: 'Pat Partner partnerships@creatorpartners.example',
            },
          ],
        },
      ]),
    );

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(upsertFromDiscovery).not.toHaveBeenCalled();
    expect(result.agencies?.[0]?.peopleFound).toBe(1);
    expect(result.agencies?.[0]?.peopleWithAttributedEmail).toBe(0);
  });

  it('excludes NOT_RELEVANT by query; SKIPPED_NO_ELIGIBLE when empty', async () => {
    influencerAgencyFindMany.mockResolvedValue([]);
    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });
    expect(result.outcome).toBe('SKIPPED_NO_ELIGIBLE');
    expect(publishContactResearchFindAgencyPeople).not.toHaveBeenCalled();
    expect(
      influencerAgencyFindMany.mock.calls[0][0].where.relevanceStatus.in,
    ).toEqual([
      AgencyRelevanceStatus.RELEVANT,
      AgencyRelevanceStatus.UNDER_REVIEW,
    ]);
  });

  it('timeout → WAIT_FAILED / aggregate PROVIDER_FAILURE (not NO_MATCHES)', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockRejectedValue(
      new AiExecutionWaitError(
        'AI_EXECUTION_WAIT_TIMEOUT',
        'timed out',
        'exec-people-1',
      ),
    );

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result.outcome).toBe('PROVIDER_FAILURE');
    expect(result.agencies?.[0]?.outcome).toBe('WAIT_FAILED');
    expect(result.outcome).not.toBe('NO_MATCHES');
  });

  it('partial persist reported as PARTIAL', async () => {
    influencerAgencyFindMany.mockResolvedValue([eligibleRow()]);
    waitForAiExecutionResult.mockResolvedValue(
      mastraPeopleResult([
        {
          name: 'Alex One',
          linkedinUrl: 'https://www.linkedin.com/in/a1',
          emails: [
            {
              email: 'a1@creatorpartners.example',
              sourceUrl: 'https://www.linkedin.com/in/a1',
              sourceKind: 'linkedin',
            },
          ],
        },
        {
          name: 'Alex Two',
          linkedinUrl: 'https://www.linkedin.com/in/a2',
          emails: [
            {
              email: 'a2@creatorpartners.example',
              sourceUrl: 'https://www.linkedin.com/in/a2',
              sourceKind: 'linkedin',
            },
          ],
        },
      ]),
    );
    upsertFromDiscovery
      .mockResolvedValueOnce({
        id: 'ok',
        created: true,
        updated: false,
        skipped: false,
      })
      .mockRejectedValueOnce(new Error('db'));

    const result = await service.researchEligibleAgencies({
      runId: 'run-1',
      influencerId: 'inf-1',
    });

    expect(result.contactsPersistedCreated).toBe(1);
    expect(result.contactsPersistFailed).toBe(1);
    expect(result.outcome).toBe('PARTIAL');
  });
});
