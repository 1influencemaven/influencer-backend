jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import {
  isBrandEmail,
  normalizeLinkedInProfile,
  registrableDomain,
  SALESHANDY_LEAD_SOURCE,
  SaleshandyEnrichmentService,
} from './saleshandy-enrichment.service';

const ctx = {
  brandCandidateId: 'bc-1',
  influencerId: 'inf-1',
  runId: 'run-1',
  domain: 'gorjana.com',
};

function setup(overrides: {
  people?: unknown[];
  contacts?: unknown[];
  credits?: number | null;
  knownLeads?: unknown[];
  reusable?: unknown[];
  enabled?: boolean;
  reveals?: Array<{ key: string; at: string }>;
}) {
  const client = {
    isEnabled: jest.fn().mockReturnValue(overrides.enabled ?? true),
    getCredits: jest.fn().mockResolvedValue(overrides.credits ?? 200),
    searchPeopleByDomain: jest
      .fn()
      .mockResolvedValue({ ok: true, people: overrides.people ?? [] }),
    enrichContacts: jest.fn().mockResolvedValue({
      ok: true,
      contacts: overrides.contacts ?? [],
      creditsCharged: (overrides.contacts ?? []).length,
    }),
  };
  const created: Array<Record<string, unknown>> = [];
  const tx = {
    lead: {
      create: jest.fn(({ data }) => {
        created.push(data);
        return { id: `lead-${created.length}` };
      }),
      update: jest.fn(),
    },
  };
  const prisma = {
    lead: {
      findMany: jest.fn(({ where }) =>
        where.source === SALESHANDY_LEAD_SOURCE
          ? (overrides.reusable ?? [])
          : (overrides.knownLeads ?? []),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    brand: {
      findUnique: jest.fn(async () => ({
        contactYield: { saleshandy: { reveals: overrides.reveals ?? [] } },
      })),
      update: jest.fn(),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const contactChannels = { createChannelsForLead: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new SaleshandyEnrichmentService(
    client as never,
    prisma as never,
    contactChannels as never,
    config as never,
  );
  return { service, client, created, contactChannels, prisma };
}

const person = (id: number, fullName: string, jobTitle: string, decisionMaker = false) => ({
  id,
  fullName,
  jobTitle,
  companyDomain: 'gorjana.com',
  decisionMaker,
  isRevealed: false,
});

describe('SaleshandyEnrichmentService.enrichByDomain', () => {
  it('reveals only the top-ranked collaboration roles within budget (2)', async () => {
    const { service, client, created } = setup({
      people: [
        person(1, 'Niki Browning', 'Lifecycle Marketing Manager'),
        person(2, 'Casey Yelich', 'Marketing Manager'),
        person(3, 'Jennifer Darrow', 'Director of Marketing', true),
        person(4, 'Ana Ruiz', 'Influencer Partnerships Lead'),
      ],
      contacts: [
        {
          fullName: 'Ana Ruiz',
          linkedinUrl: 'https://linkedin.com/in/Ana-Ruiz',
          emails: [{ email: 'ana@gorjana.com', status: 'valid' }],
        },
        {
          fullName: 'Jennifer Darrow',
          jobTitle: 'Director of Marketing',
          emails: [{ email: 'jennifer@gorjana.com', status: 'risky' }],
        },
      ],
    });

    const trace = await service.enrichByDomain(ctx);

    expect(client.enrichContacts).toHaveBeenCalledWith(
      { leadIds: [4, 3] },
      expect.any(Object),
    );
    expect(trace).toMatchObject({
      peopleFound: 4,
      peopleRanked: 3,
      submitted: 2,
      validEmails: 1,
      riskyEmails: 1,
      leadsCreated: 2,
    });
    expect(service.hasTier1(trace)).toBe(true);
    expect(created[0]).toMatchObject({
      contactName: 'Ana Ruiz',
      title: 'Influencer Partnerships Lead',
      email: 'ana@gorjana.com',
      emailConfidence: 'VALID',
      profileUrl: 'https://www.linkedin.com/in/ana-ruiz',
      source: SALESHANDY_LEAD_SOURCE,
    });
    expect(created[1]).toMatchObject({ emailConfidence: 'PROBABLE' });
  });

  it('keeps the person but drops an undeliverable (bad) email', async () => {
    const { service, created } = setup({
      people: [person(4, 'Ana Ruiz', 'PR Manager')],
      contacts: [
        { fullName: 'Ana Ruiz', emails: [{ email: 'ana@gorjana.com', status: 'bad' }] },
      ],
    });
    const trace = await service.enrichByDomain(ctx);
    expect(trace.badEmails).toBe(1);
    expect(created[0].email).toBeUndefined();
    expect(service.hasTier1(trace)).toBe(false);
  });

  it('reuses emails already revealed for the domain instead of buying them again', async () => {
    const { service, client, created } = setup({
      people: [person(4, 'Ana Ruiz', 'PR Manager')],
      reusable: [
        {
          contactName: 'Jennifer Darrow',
          title: 'Director of Marketing',
          email: 'jennifer@gorjana.com',
          emailConfidence: 'VALID',
          profileUrl: null,
        },
        {
          contactName: 'Casey Yelich',
          title: 'Marketing Manager',
          email: 'casey@gorjana.com',
          emailConfidence: 'VALID',
          profileUrl: null,
        },
      ],
    });
    const trace = await service.enrichByDomain(ctx);
    expect(trace.reusedFromKnowledgeBase).toBe(2);
    expect(trace.skippedReason).toBe('NO_BUDGET');
    expect(client.enrichContacts).not.toHaveBeenCalled();
    expect(created.map((c) => c.email)).toEqual([
      'jennifer@gorjana.com',
      'casey@gorjana.com',
    ]);
  });

  it('does not spend below the minimum credit balance', async () => {
    const { service, client } = setup({
      people: [person(4, 'Ana Ruiz', 'PR Manager')],
      credits: 5,
    });
    const trace = await service.enrichByDomain(ctx);
    expect(trace.skippedReason).toBe('LOW_CREDITS');
    expect(client.enrichContacts).not.toHaveBeenCalled();
  });

  it('is a no-op when disabled', async () => {
    const { service, client } = setup({ enabled: false });
    const trace = await service.enrichByDomain(ctx);
    expect(trace).toMatchObject({ enabled: false, skippedReason: 'DISABLED' });
    expect(client.searchPeopleByDomain).not.toHaveBeenCalled();
  });
});

describe('per-domain reveal budget (BKB contactYield)', () => {
  const now = new Date().toISOString();

  it('records reveals on the Brand row before spending', async () => {
    const { service, prisma } = setup({
      people: [person(4, 'Ana Ruiz', 'PR Manager')],
      contacts: [],
    });
    await service.enrichByDomain(ctx);
    expect(prisma.brand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { domain: 'gorjana.com' },
        data: {
          contactYield: expect.objectContaining({
            saleshandy: expect.objectContaining({
              reveals: [expect.objectContaining({ key: 'id:4' })],
            }),
          }),
        },
      }),
    );
  });

  it('does not spend again when the 30-day domain budget is used (retries/other influencers)', async () => {
    const { service, client } = setup({
      people: [person(5, 'Leo Paz', 'Influencer Manager')],
      reveals: [
        { key: 'id:1', at: now },
        { key: 'id:2', at: now },
      ],
    });
    const trace = await service.enrichByDomain(ctx);
    expect(trace.skippedReason).toBe('NO_BUDGET');
    expect(client.enrichContacts).not.toHaveBeenCalled();
  });

  it('never re-reveals the same person and frees budget after 30 days', async () => {
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    const { service, client } = setup({
      people: [
        person(1, 'Ana Ruiz', 'Influencer Manager'),
        person(5, 'Leo Paz', 'PR Manager'),
      ],
      reveals: [
        { key: 'id:1', at: old },
        { key: 'id:9', at: old },
      ],
    });
    await service.enrichByDomain(ctx);
    expect(client.enrichContacts).toHaveBeenCalledWith(
      { leadIds: [5] },
      expect.any(Object),
    );
  });
});

describe('brand email domain gate', () => {
  it('skips people whose revealed email belongs to another company', async () => {
    const { service, created } = setup({
      people: [person(4, 'Grace Jones', 'Social Media & Community Manager')],
      contacts: [
        { fullName: 'Grace Jones', emails: [{ email: 'grace.jones@cyrus.nyc', status: 'valid' }] },
      ],
    });
    const trace = await service.enrichByDomain(ctx);
    expect(trace.offDomainSkipped).toBe(1);
    expect(trace.validEmails).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('matches the registrable domain (us.maje.com ↔ maje.com)', () => {
    expect(registrableDomain('us.maje.com')).toBe('maje.com');
    expect(registrableDomain('shop.brand.co.uk')).toBe('brand.co.uk');
    expect(isBrandEmail('ana@maje.com', 'us.maje.com')).toBe(true);
    expect(isBrandEmail('ana@cyrus.nyc', 'jonathanadler.com')).toBe(false);
  });
});

describe('normalizeLinkedInProfile', () => {
  it('canonicalizes /in/ URLs and rejects others', () => {
    expect(normalizeLinkedInProfile('linkedin.com/in/Jennifer-Darrow/')).toBe(
      'https://www.linkedin.com/in/jennifer-darrow',
    );
    expect(normalizeLinkedInProfile('https://www.linkedin.com/company/gorjana')).toBeNull();
    expect(normalizeLinkedInProfile(null)).toBeNull();
  });
});
