import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('./influencers.service', () => ({
  InfluencersService: class InfluencersService {},
  influencerDetailSelect: {},
}));

import { BrightDataDatasetClient } from '../integrations/brightdata/brightdata-dataset.client';
import { InfluencerDataOrigin } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { InfluencersService } from './influencers.service';
import { InstagramResearchService } from './instagram-research.service';
import { INFLUENCER_FIELD_KEYS } from './utils/influencer-field-keys';

describe('InstagramResearchService', () => {
  let service: InstagramResearchService;

  const influencersService = {
    findOne: jest.fn(),
    planExternalFieldMerge: jest.fn(),
    applyExternalFieldPatch: jest.fn(),
  };

  const datasetClient = {
    isConfigured: jest.fn(),
    scrapeByUrl: jest.fn(),
  };

  const prisma = {
    influencer: {
      findFirst: jest.fn(),
    },
  };

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'BRIGHTDATA_INSTAGRAM_PROFILE_DATASET_ID') {
        return 'gd_l1vikfch901nx3by4';
      }
      return undefined;
    }),
  };

  const current = {
    id: 'inf-1',
    name: 'Laura',
    instagram: '@laurafit_es',
    instagramNormalized: 'laurafit_es',
    followers: 100,
    email: null,
    fieldProvenances: [
      {
        fieldKey: INFLUENCER_FIELD_KEYS.NAME,
        origin: InfluencerDataOrigin.MANUAL,
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramResearchService,
        { provide: InfluencersService, useValue: influencersService },
        { provide: BrightDataDatasetClient, useValue: datasetClient },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(InstagramResearchService);
    jest.clearAllMocks();
    influencersService.findOne.mockResolvedValue(current);
    datasetClient.isConfigured.mockReturnValue(true);
  });

  it('updates EXTERNAL fields and skips MANUAL name', async () => {
    datasetClient.scrapeByUrl.mockResolvedValue({
      ok: true,
      url: 'https://www.instagram.com/laurafit_es/',
      row: {
        account: 'laurafit_es',
        profile_name: 'Scraped Name',
        followers: 250_000,
        email_address: 'contact@agency.com',
        is_private: false,
      },
    });
    prisma.influencer.findFirst.mockResolvedValue(null);
    influencersService.planExternalFieldMerge.mockReturnValue({
      patch: {
        [INFLUENCER_FIELD_KEYS.FOLLOWERS]: 250_000,
        [INFLUENCER_FIELD_KEYS.EMAIL]: 'contact@agency.com',
      },
      provenanceKeys: [
        INFLUENCER_FIELD_KEYS.FOLLOWERS,
        INFLUENCER_FIELD_KEYS.EMAIL,
      ],
    });
    influencersService.applyExternalFieldPatch.mockResolvedValue({
      ...current,
      followers: 250_000,
      email: 'contact@agency.com',
    });

    const result = await service.researchByInfluencerId('inf-1');

    expect(datasetClient.scrapeByUrl).toHaveBeenCalledWith({
      datasetId: 'gd_l1vikfch901nx3by4',
      url: 'https://www.instagram.com/laurafit_es/',
    });
    expect(influencersService.planExternalFieldMerge).toHaveBeenCalled();
    expect(influencersService.applyExternalFieldPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        influencerId: 'inf-1',
        provenanceKeys: [
          INFLUENCER_FIELD_KEYS.FOLLOWERS,
          INFLUENCER_FIELD_KEYS.EMAIL,
        ],
        source: 'brightdata:instagram:gd_l1vikfch901nx3by4',
      }),
    );
    expect(result.research.outcome).toBe('UPDATED');
    expect(result.research.skippedManualFields).toContain(
      INFLUENCER_FIELD_KEYS.NAME,
    );
  });

  it('returns PROFILE_PRIVATE without persisting', async () => {
    datasetClient.scrapeByUrl.mockResolvedValue({
      ok: true,
      row: { account: 'laurafit_es', is_private: true, followers: 10 },
    });

    const result = await service.researchByInfluencerId('inf-1');

    expect(result.research.outcome).toBe('PROFILE_PRIVATE');
    expect(influencersService.applyExternalFieldPatch).not.toHaveBeenCalled();
  });

  it('throws when Bright Data is not configured', async () => {
    datasetClient.isConfigured.mockReturnValue(false);

    await expect(service.researchByInfluencerId('inf-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('throws PROVIDER_TIMEOUT on scrape timeout', async () => {
    datasetClient.scrapeByUrl.mockResolvedValue({
      ok: false,
      errorCode: 'timeout',
      error: 'snapshot poll timeout',
    });

    await expect(service.researchByInfluencerId('inf-1')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
  });

  it('throws PROFILE_NOT_FOUND for empty / missing profiles', async () => {
    datasetClient.scrapeByUrl.mockResolvedValue({
      ok: true,
      row: { warning_code: 'dead_page', warning: 'not found' },
    });

    await expect(service.researchByInfluencerId('inf-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws INCOMPLETE_RESPONSE when row has no mappable fields', async () => {
    datasetClient.scrapeByUrl.mockResolvedValue({
      ok: true,
      row: { account: 'laurafit_es', id: '1', is_private: false },
    });

    await expect(service.researchByInfluencerId('inf-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects invalid Instagram handle', async () => {
    influencersService.findOne.mockResolvedValue({
      ...current,
      instagram: null,
      instagramNormalized: null,
    });

    await expect(service.researchByInfluencerId('inf-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when provider account collides with another talent', async () => {
    datasetClient.scrapeByUrl.mockResolvedValue({
      ok: true,
      row: {
        account: 'other_talent',
        followers: 1,
        is_private: false,
      },
    });
    prisma.influencer.findFirst.mockResolvedValue({ id: 'other-id' });

    await expect(service.researchByInfluencerId('inf-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  describe('researchByUsername', () => {
    it('accepts a valid username and returns FOUND without Prisma writes', async () => {
      datasetClient.scrapeByUrl.mockResolvedValue({
        ok: true,
        row: {
          account: 'belu.deltoro',
          profile_name: 'Belu',
          followers: 1500,
          biography: 'Host',
          is_private: false,
        },
      });

      const result = await service.researchByUsername('belu.deltoro');

      expect(datasetClient.scrapeByUrl).toHaveBeenCalledWith({
        datasetId: 'gd_l1vikfch901nx3by4',
        url: 'https://www.instagram.com/belu.deltoro/',
      });
      expect(result.research.outcome).toBe('FOUND');
      expect(result.research.persisted).toBe(false);
      expect(result.normalized.followers).toBe(1500);
      expect(result.provider).toHaveProperty('biography', 'Host');
      expect(influencersService.findOne).not.toHaveBeenCalled();
      expect(influencersService.applyExternalFieldPatch).not.toHaveBeenCalled();
      expect(prisma.influencer.findFirst).not.toHaveBeenCalled();
    });

    it('accepts username with @ prefix', async () => {
      datasetClient.scrapeByUrl.mockResolvedValue({
        ok: true,
        row: {
          account: 'belu.deltoro',
          followers: 10,
          is_private: false,
        },
      });

      const result = await service.researchByUsername('@Belu.Deltoro');

      expect(result.research.handleNormalized).toBe('belu.deltoro');
      expect(datasetClient.scrapeByUrl).toHaveBeenCalledWith({
        datasetId: 'gd_l1vikfch901nx3by4',
        url: 'https://www.instagram.com/belu.deltoro/',
      });
    });

    it('rejects invalid username', async () => {
      await expect(service.researchByUsername('bad user!!!')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(datasetClient.scrapeByUrl).not.toHaveBeenCalled();
    });

    it('returns PROFILE_PRIVATE without persisting', async () => {
      datasetClient.scrapeByUrl.mockResolvedValue({
        ok: true,
        row: { account: 'secret', is_private: true, followers: 1 },
      });

      const result = await service.researchByUsername('secret');
      expect(result.research.outcome).toBe('PROFILE_PRIVATE');
      expect(result.research.persisted).toBe(false);
      expect(influencersService.applyExternalFieldPatch).not.toHaveBeenCalled();
    });

    it('throws PROFILE_NOT_FOUND', async () => {
      datasetClient.scrapeByUrl.mockResolvedValue({
        ok: true,
        row: { warning_code: 'dead_page', warning: 'not found' },
      });
      await expect(service.researchByUsername('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws INCOMPLETE_RESPONSE', async () => {
      datasetClient.scrapeByUrl.mockResolvedValue({
        ok: true,
        row: { id: '1', is_private: false },
      });
      await expect(service.researchByUsername('empty')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('throws PROVIDER_ERROR', async () => {
      datasetClient.scrapeByUrl.mockResolvedValue({
        ok: false,
        errorCode: 'trigger_failed',
        error: 'trigger 401',
      });
      await expect(service.researchByUsername('anyone')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('throws PROVIDER_TIMEOUT', async () => {
      datasetClient.scrapeByUrl.mockResolvedValue({
        ok: false,
        errorCode: 'timeout',
      });
      await expect(service.researchByUsername('anyone')).rejects.toBeInstanceOf(
        GatewayTimeoutException,
      );
    });

    it('throws NOT_CONFIGURED without calling scrape', async () => {
      datasetClient.isConfigured.mockReturnValue(false);
      await expect(service.researchByUsername('anyone')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(datasetClient.scrapeByUrl).not.toHaveBeenCalled();
    });
  });
});
