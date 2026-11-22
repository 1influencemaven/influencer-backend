import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('./influencers.service', () => ({
  InfluencersService: class InfluencersService {},
}));

jest.mock('./instagram-research.service', () => ({
  InstagramResearchService: class InstagramResearchService {},
}));

jest.mock('../auth/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

jest.mock('../auth/guards/roles.guard', () => ({
  RolesGuard: class RolesGuard {},
}));

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';
import { InstagramResearchService } from './instagram-research.service';

describe('InfluencersController', () => {
  let influencersController: InfluencersController;

  const influencersService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findEligibleManagers: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const instagramResearchService = {
    enqueueByInfluencerId: jest.fn(),
    enqueueByUsername: jest.fn(),
    getRun: jest.fn(),
    getActiveRunForInfluencer: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InfluencersController],
      providers: [
        { provide: InfluencersService, useValue: influencersService },
        {
          provide: InstagramResearchService,
          useValue: instagramResearchService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    influencersController = module.get<InfluencersController>(
      InfluencersController,
    );
    jest.clearAllMocks();
  });

  it('should delegate findAll to the service', async () => {
    const paginated = {
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
    influencersService.findAll.mockResolvedValue(paginated);

    await expect(
      influencersController.findAll({ page: 1, limit: 20 }),
    ).resolves.toEqual(paginated);
    expect(influencersService.findAll).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
    });
  });

  it('should delegate findOne to the service', async () => {
    influencersService.findOne.mockResolvedValue({ id: 'influencer-id' });

    await expect(
      influencersController.findOne('influencer-id'),
    ).resolves.toEqual({
      id: 'influencer-id',
    });
  });

  it('should delegate findEligibleManagers to the service', async () => {
    const managers = [
      { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'ADMIN' },
    ];
    influencersService.findEligibleManagers.mockResolvedValue(managers);

    await expect(
      influencersController.findEligibleManagers(),
    ).resolves.toEqual(managers);
  });

  it('should delegate create to the service', async () => {
    const dto = {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      country: 'ES',
    };
    influencersService.create.mockResolvedValue({
      id: 'influencer-id',
      ...dto,
    });

    await expect(influencersController.create(dto)).resolves.toEqual({
      id: 'influencer-id',
      ...dto,
    });
  });

  it('should delegate update to the service', async () => {
    const dto = { name: 'Laura M.' };
    influencersService.update.mockResolvedValue({
      id: 'influencer-id',
      ...dto,
    });

    await expect(
      influencersController.update('influencer-id', dto),
    ).resolves.toEqual({ id: 'influencer-id', ...dto });
  });

  it('should delegate remove to the service', async () => {
    influencersService.remove.mockResolvedValue({
      message: 'Influencer deleted successfully',
    });

    await expect(
      influencersController.remove('influencer-id'),
    ).resolves.toEqual({
      message: 'Influencer deleted successfully',
    });
  });

  it('should propagate service exceptions', async () => {
    influencersService.findOne.mockRejectedValue(
      new NotFoundException('Influencer not found'),
    );

    await expect(influencersController.findOne('missing-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should enqueue Instagram research by influencer id', async () => {
    const payload = {
      id: 'run-1',
      status: 'PROCESSING',
      mode: 'INFLUENCER',
      influencerId: 'influencer-id',
    };
    instagramResearchService.enqueueByInfluencerId.mockResolvedValue(payload);

    await expect(
      influencersController.researchInstagram('influencer-id'),
    ).resolves.toEqual(payload);
    expect(
      instagramResearchService.enqueueByInfluencerId,
    ).toHaveBeenCalledWith('influencer-id');
  });

  it('should enqueue username Instagram research without influencer id', async () => {
    const payload = {
      id: 'run-2',
      status: 'PROCESSING',
      mode: 'USERNAME',
      handleNormalized: 'belu.deltoro',
    };
    instagramResearchService.enqueueByUsername.mockResolvedValue(payload);

    await expect(
      influencersController.researchInstagramByUsername({
        username: '@belu.deltoro',
      }),
    ).resolves.toEqual(payload);
    expect(instagramResearchService.enqueueByUsername).toHaveBeenCalledWith(
      '@belu.deltoro',
    );
  });

  it('should get Instagram research run by id', async () => {
    const payload = { id: 'run-3', status: 'COMPLETED' };
    instagramResearchService.getRun.mockResolvedValue(payload);

    await expect(
      influencersController.getInstagramResearchRun('run-3'),
    ).resolves.toEqual(payload);
    expect(instagramResearchService.getRun).toHaveBeenCalledWith('run-3');
  });

  it('should get active Instagram research run for influencer', async () => {
    const payload = { id: 'run-active', status: 'PROCESSING' };
    instagramResearchService.getActiveRunForInfluencer.mockResolvedValue(
      payload,
    );

    await expect(
      influencersController.getActiveInstagramResearch('influencer-id'),
    ).resolves.toEqual(payload);
    expect(
      instagramResearchService.getActiveRunForInfluencer,
    ).toHaveBeenCalledWith('influencer-id');
  });
});
