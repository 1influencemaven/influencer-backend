import type { AiExecutionRequest } from '@influence-maven/ai-contracts';

import { BrightDataToolsClient } from '../brightdata/client';
import type { InfluencerAiEnv } from '../config/env';
import { runContactResearchFindAgencyPeople } from './run-find-agency-people';

const baseEnv: InfluencerAiEnv = {
  redisHost: '127.0.0.1',
  redisPort: 6379,
  redisDb: 0,
  aiProvider: 'ollama',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b',
  anthropicApiKey: undefined,
  anthropicModel: 'claude-sonnet-4-20250514',
  brightDataApiKey: 'k',
  brightDataSerpZone: 'serp_api',
  brightDataUnlockerZone: 'mcp_unlocker',
  brightDataTimeoutMs: 60000,
  brightDataLinkedInPeopleDatasetId: 'gd_test',
  brightDataScraperPollTimeoutMs: 120000,
  brightDataScraperPollIntervalMs: 3000,
};

function request(
  overrides?: Partial<
    Extract<AiExecutionRequest, { type: 'CONTACT_RESEARCH' }>['input']
  >,
): Extract<AiExecutionRequest, { type: 'CONTACT_RESEARCH' }> {
  return {
    contractVersion: '1.0',
    executionId: '11111111-1111-4111-8111-111111111111',
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'agency-people:test',
    requestedAt: new Date().toISOString(),
    type: 'CONTACT_RESEARCH',
    context: {
      userId: 'u',
      influencerId: '00000000-0000-4000-8000-000000000099',
      resourceId: '00000000-0000-4000-8000-000000000098',
      resourceType: 'CONTACT_RESEARCH_RUN',
    },
    instructions: { business: '', businessHash: '0'.repeat(16) },
    input: {
      operation: 'FIND_AGENCY_PEOPLE',
      agencyId: 'agency-1',
      agencyName: 'Creator Partners',
      website: 'https://creatorpartners.test',
      domain: 'creatorpartners.test',
      peoplePassPolicy: 'ALWAYS',
      maxSerpQueries: 2,
      maxProfilesToScrape: 2,
      maxAgencyPages: 2,
      ...overrides,
    },
  };
}

describe('runContactResearchFindAgencyPeople (2C.4.6)', () => {
  it('rejects wrong operation', async () => {
    const bad = request();
    (bad as { input: { operation: string } }).input.operation =
      'FIND_AGENCY_EMAILS';
    const result = await runContactResearchFindAgencyPeople(baseEnv, bad, {
      client: { isConfigured: () => true } as never,
    });
    expect(result.ok).toBe(false);
  });

  it('PROVIDER_FAILURE when Bright Data not configured', async () => {
    const result = await runContactResearchFindAgencyPeople(baseEnv, request(), {
      client: { isConfigured: () => false } as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AI_PROVIDER_ERROR');
  });

  it('finds LinkedIn people with linkedin sourceKind + UNVERIFIED provenance', async () => {
    const client = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          {
            url: 'https://www.linkedin.com/in/alex-partner',
            title: 'Alex',
            snippet: '',
          },
        ],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
      scrapeLinkedInProfile: jest.fn().mockResolvedValue({
        ok: true,
        name: 'Alex Partner',
        title: 'Head of Influencer Partnerships',
        url: 'https://www.linkedin.com/in/alex-partner',
        about: 'Reach me at alex@creatorpartners.test',
        emailFields: ['alex@creatorpartners.test'],
      }),
      openPage: jest.fn().mockResolvedValue({
        ok: false,
        httpStatus: 0,
        bodyLength: 0,
        elapsedMs: 1,
        emptyBody: true,
        brdError: 'skipped',
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyPeople(
      baseEnv,
      request(),
      { client },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.operation).toBe('FIND_AGENCY_PEOPLE');
    expect(result.output.outcome).toBe('RESULTS_FOUND');
    expect(result.output.people[0]?.name).toBe('Alex Partner');
    expect(result.output.people[0]?.emails[0]?.sourceKind).toBe('linkedin');
    expect(result.output.people[0]?.emails[0]?.provenance?.verificationStatus).toBe(
      'UNVERIFIED',
    );
  });

  it('reuses RF-04 snapshots (agency_web) and rejects off-domain snaps', async () => {
    const openPage = jest.fn();
    const client = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          {
            url: 'https://www.linkedin.com/in/sam-talent',
            title: 'Sam',
            snippet: '',
          },
        ],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
      scrapeLinkedInProfile: jest.fn().mockResolvedValue({
        ok: true,
        name: 'Sam Talent',
        title: 'Talent Partnerships',
        url: 'https://www.linkedin.com/in/sam-talent',
        about: '',
        emailFields: [],
      }),
      openPage,
    } as unknown as BrightDataToolsClient;

    // maxAgencyPages=2 → candidates are "/" then "/team"; both covered by snaps.
    const result = await runContactResearchFindAgencyPeople(
      baseEnv,
      request({
        pageSnapshots: [
          {
            url: 'https://creatorpartners.test/',
            normalizedUrl: 'https://creatorpartners.test/',
            fetchedAt: new Date().toISOString(),
            content: '<p>home</p>',
            truncated: false,
          },
          {
            url: 'https://creatorpartners.test/team',
            normalizedUrl: 'https://creatorpartners.test/team',
            fetchedAt: new Date().toISOString(),
            content:
              '<p>Sam Talent — email sam.talent@creatorpartners.test</p><a href="mailto:sam.talent@creatorpartners.test">x</a>',
            truncated: false,
            mailtoEmails: ['sam.talent@creatorpartners.test'],
          },
          {
            url: 'https://evil.example/team',
            fetchedAt: new Date().toISOString(),
            content: '<a href="mailto:x@evil.example">x</a>',
            truncated: false,
          },
        ],
        maxAgencyPages: 2,
      }),
      { client },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(openPage).not.toHaveBeenCalled();
    expect(result.output.trace?.peeReuse?.snapshotsReceivedFromEmailsPass).toBe(
      3,
    );
    expect(result.output.trace?.peeReuse?.peePagesReused).toBe(2);
    expect(result.output.trace?.peeReuse?.peePagesRejected).toBe(1);
    expect(result.output.trace?.peeReuse?.peePagesFetchedUnlocker).toBe(0);
    const person = result.output.people[0];
    expect(
      person?.emails.some((e) => e.sourceKind === 'agency_web'),
    ).toBe(true);
  });

  it('falls back to Unlocker when no eligible snapshot exists', async () => {
    const openPage = jest.fn().mockResolvedValue({
      ok: true,
      httpStatus: 200,
      bodyLength: 80,
      elapsedMs: 1,
      html: '<p>Sam Talent sam.talent@creatorpartners.test</p><a href="mailto:sam.talent@creatorpartners.test">x</a>',
      emptyBody: false,
    });
    const client = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          {
            url: 'https://www.linkedin.com/in/sam-talent',
            title: 'Sam',
            snippet: '',
          },
        ],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
      scrapeLinkedInProfile: jest.fn().mockResolvedValue({
        ok: true,
        name: 'Sam Talent',
        title: 'Talent Partnerships',
        url: 'https://www.linkedin.com/in/sam-talent',
        about: '',
        emailFields: [],
      }),
      openPage,
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyPeople(
      baseEnv,
      request({ pageSnapshots: [], maxAgencyPages: 1 }),
      { client },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(openPage).toHaveBeenCalled();
    expect(result.output.trace?.agencyPagesFetched).toBeGreaterThan(0);
    expect(
      result.output.people[0]?.emails.some((e) => e.sourceKind === 'agency_web'),
    ).toBe(true);
  });

  it('does not attribute generic mailbox to person by local-part', async () => {
    const client = {
      isConfigured: () => true,
      searchWeb: jest.fn().mockResolvedValue({
        ok: true,
        organics: [
          {
            url: 'https://www.linkedin.com/in/pat-partner',
            title: 'Pat',
            snippet: '',
          },
        ],
        httpStatus: 200,
        bodyLength: 2,
        elapsedMs: 1,
        emptyBody: false,
      }),
      scrapeLinkedInProfile: jest.fn().mockResolvedValue({
        ok: true,
        name: 'Pat Partner',
        title: 'Partnerships',
        url: 'https://www.linkedin.com/in/pat-partner',
        about: '',
        emailFields: [],
      }),
      openPage: jest.fn().mockResolvedValue({
        ok: true,
        httpStatus: 200,
        bodyLength: 40,
        elapsedMs: 1,
        html: '<p>Pat Partner partnerships@creatorpartners.test</p><a href="mailto:partnerships@creatorpartners.test">x</a>',
        emptyBody: false,
      }),
    } as unknown as BrightDataToolsClient;

    const result = await runContactResearchFindAgencyPeople(
      baseEnv,
      request({ pageSnapshots: [] }),
      { client },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.people[0]?.emails).toEqual([]);
  });
});
