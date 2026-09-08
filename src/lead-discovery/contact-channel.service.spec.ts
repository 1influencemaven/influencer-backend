jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { BadRequestException, ConflictException } from '@nestjs/common';

import {
  ContactChannelSource,
  ContactChannelStatus,
  ContactChannelType,
} from '../generated/prisma/enums';
import { ContactChannelService } from './contact-channel.service';

describe('ContactChannelService', () => {
  const prisma = {
    lead: { findUnique: jest.fn(), update: jest.fn() },
    contactChannel: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: ContactChannelService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ContactChannelService(prisma as never);
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    prisma.contactChannel.findMany.mockResolvedValue([]);
    prisma.lead.update.mockResolvedValue({});
  });

  it('rejects PUBLIC_WEB email without evidence', async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
    await expect(
      service.addChannel('l1', {
        type: ContactChannelType.EMAIL,
        value: 'info@company.com',
        source: ContactChannelSource.PUBLIC_WEB,
        isGeneric: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts PUBLIC_WEB email with literal evidence', async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
    prisma.contactChannel.findUnique.mockResolvedValue(null);
    prisma.contactChannel.create.mockResolvedValue({
      id: 'c1',
      leadId: 'l1',
      type: ContactChannelType.EMAIL,
      value: 'info@company.com',
      status: ContactChannelStatus.ACTIVE,
      source: ContactChannelSource.PUBLIC_WEB,
      sourceUrl: 'https://company.com/contact',
      isGeneric: true,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.addChannel('l1', {
      type: ContactChannelType.EMAIL,
      value: 'info@company.com',
      source: ContactChannelSource.PUBLIC_WEB,
      sourceUrl: 'https://company.com/contact',
      isGeneric: true,
      metadata: {
        evidences: [
          { evidenceSnippet: 'Contact us at info@company.com for help' },
        ],
      },
    });

    expect(result.value).toBe('info@company.com');
    expect(prisma.lead.update).toHaveBeenCalled();
  });

  it('throws conflict on duplicate channel', async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
    prisma.contactChannel.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.addChannel('l1', {
        type: ContactChannelType.LINKEDIN,
        value: 'https://linkedin.com/in/user',
        source: ContactChannelSource.MANUAL,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates multiple channel types for a lead', async () => {
    prisma.contactChannel.findUnique.mockResolvedValue(null);
    prisma.contactChannel.create.mockResolvedValue({});
    await service.createChannelsForLead(prisma as never, 'l1', [
      {
        type: ContactChannelType.LINKEDIN,
        value: 'https://linkedin.com/in/user',
        source: ContactChannelSource.LINKEDIN_SCRAPER,
      },
      {
        type: ContactChannelType.WEBSITE,
        value: 'https://company.com',
        source: ContactChannelSource.BRAND_WEBSITE,
      },
    ]);
    expect(prisma.contactChannel.create).toHaveBeenCalledTimes(2);
  });

  it('maps PublicEmailCandidate to EMAIL PUBLIC_WEB channel', () => {
    const channel = service.mapPublicEmailCandidateToChannel({
      email: 'info@company.com',
      isGeneric: true,
      evidences: [
        {
          sourceUrl: 'https://company.com/contact',
          sourceType: 'public-web',
          evidenceSnippet: 'Email info@company.com',
          discoveredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(channel.type).toBe(ContactChannelType.EMAIL);
    expect(channel.source).toBe(ContactChannelSource.PUBLIC_WEB);
    expect(channel.isGeneric).toBe(true);
    expect(channel.sourceUrl).toBe('https://company.com/contact');
    expect(channel.metadata).toEqual({
      evidences: [
        {
          sourceUrl: 'https://company.com/contact',
          evidenceSnippet: 'Email info@company.com',
          discoveredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('rejects PUBLIC_WEB email without evidence when persisting', async () => {
    prisma.contactChannel.findUnique.mockResolvedValue(null);

    await expect(
      service.persistPublicEmailEnrichment(prisma as never, 'l1', {
        candidates: [
          {
            email: 'info@company.com',
            isGeneric: true,
            evidences: [],
          },
        ],
        summary: {
          pagesAttempted: 0,
          pagesSucceeded: 0,
          emailsFound: 0,
          genericEmailsFound: 0,
          nonGenericEmailsFound: 0,
          errors: 0,
          pageResults: [],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists website and email channels from public email result', async () => {
    prisma.contactChannel.findUnique.mockResolvedValue(null);
    prisma.contactChannel.create.mockResolvedValue({});

    const stats = await service.persistPublicEmailEnrichment(
      prisma as never,
      'l1',
      {
        candidates: [
          {
            email: 'info@company.com',
            isGeneric: true,
            evidences: [
              {
                sourceUrl: 'https://company.com/contact',
                sourceType: 'public-web',
                evidenceSnippet: 'Reach us at info@company.com',
                discoveredAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        ],
        summary: {
          companyName: 'Company',
          website: 'https://company.com',
          pagesAttempted: 2,
          pagesSucceeded: 1,
          emailsFound: 1,
          genericEmailsFound: 1,
          nonGenericEmailsFound: 0,
          errors: 0,
          pageResults: [],
        },
      },
    );

    expect(stats.channelsAdded.website).toBe(1);
    expect(stats.channelsAdded.email).toBe(1);
    expect(prisma.contactChannel.create).toHaveBeenCalledTimes(2);
    expect(prisma.lead.update).toHaveBeenCalled();
  });

  it('merges evidences on duplicate email channel without creating a new row', async () => {
    prisma.contactChannel.findUnique.mockResolvedValue({
      id: 'existing',
      metadata: {
        evidences: [
          {
            sourceUrl: 'https://company.com/a',
            evidenceSnippet: 'info@company.com on page a',
          },
        ],
      },
      sourceUrl: 'https://company.com/a',
      isGeneric: true,
    });
    prisma.contactChannel.update.mockResolvedValue({});

    const stats = await service.persistPublicEmailEnrichment(
      prisma as never,
      'l1',
      {
        candidates: [
          {
            email: 'info@company.com',
            isGeneric: true,
            evidences: [
              {
                sourceUrl: 'https://company.com/b',
                sourceType: 'public-web',
                evidenceSnippet: 'info@company.com on page b',
                discoveredAt: '2026-01-02T00:00:00.000Z',
              },
            ],
          },
        ],
        summary: {
          pagesAttempted: 1,
          pagesSucceeded: 1,
          emailsFound: 1,
          genericEmailsFound: 1,
          nonGenericEmailsFound: 0,
          errors: 0,
          pageResults: [],
        },
      },
    );

    expect(stats.channelsAdded.email).toBe(0);
    expect(prisma.contactChannel.create).not.toHaveBeenCalled();
    expect(prisma.contactChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            evidences: expect.arrayContaining([
              expect.objectContaining({ sourceUrl: 'https://company.com/a' }),
              expect.objectContaining({ sourceUrl: 'https://company.com/b' }),
            ]),
          }),
        }),
      }),
    );
  });
});
