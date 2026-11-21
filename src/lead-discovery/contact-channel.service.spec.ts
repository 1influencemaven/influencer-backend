jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { BadRequestException, ConflictException } from '@nestjs/common';

import {
  CommercialRelevance,
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
      commercialRelevance: CommercialRelevance.UNKNOWN,
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
});
