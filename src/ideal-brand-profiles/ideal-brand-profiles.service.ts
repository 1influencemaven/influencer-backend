import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '../generated/prisma/client';

import { AiPromptsService } from '../ai-prompts/ai-prompts.service';
import { AI_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import { IbpStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateIdealBrandProfileDto } from './dto/update-ideal-brand-profile.dto';
import type { GenerateIdealBrandProfileJobData } from './interfaces/generate-ideal-brand-profile-job.interface';

export const idealBrandProfileSelect = {
  id: true,
  influencerId: true,
  status: true,
  targetSectors: true,
  excludedSectors: true,
  brandSize: true,
  markets: true,
  collaborationTypes: true,
  summary: true,
  alertSignals: true,
  desirableCriteria: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class IdealBrandProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiPromptsService: AiPromptsService,
    @InjectQueue(QUEUES.AI) private readonly aiQueue: Queue,
  ) {}

  async findByInfluencerId(influencerId: string) {
    await this.ensureInfluencerExists(influencerId);

    const profile = await this.prisma.idealBrandProfile.findUnique({
      where: { influencerId },
      select: idealBrandProfileSelect,
    });

    if (!profile) {
      throw new NotFoundException('Ideal brand profile not found');
    }

    return profile;
  }

  async generate(influencerId: string) {
    await this.ensureInfluencerExists(influencerId);
    return this.enqueueGeneration(influencerId, 'IBP generation job enqueued');
  }

  async regenerate(influencerId: string) {
    await this.ensureInfluencerExists(influencerId);

    const existing = await this.prisma.idealBrandProfile.findUnique({
      where: { influencerId },
      select: { status: true },
    });

    if (!existing) {
      return this.enqueueGeneration(
        influencerId,
        'IBP generation job enqueued',
      );
    }

    return this.enqueueGeneration(
      influencerId,
      'IBP regeneration job enqueued',
    );
  }

  async save(influencerId: string, dto: UpdateIdealBrandProfileDto) {
    await this.ensureInfluencerExists(influencerId);

    const existing = await this.prisma.idealBrandProfile.findUnique({
      where: { influencerId },
      select: { status: true },
    });

    if (!existing) {
      throw new NotFoundException('Ideal brand profile not found');
    }

    if (existing.status === IbpStatus.PROCESSING) {
      throw new ConflictException(
        'Cannot save while IBP generation is in progress',
      );
    }

    return this.prisma.idealBrandProfile.update({
      where: { influencerId },
      data: {
        ...dto,
        status: IbpStatus.ACTIVE,
      },
      select: idealBrandProfileSelect,
    });
  }

  private async enqueueGeneration(influencerId: string, message: string) {
    const existing = await this.prisma.idealBrandProfile.findUnique({
      where: { influencerId },
      select: { status: true },
    });

    if (existing?.status === IbpStatus.PROCESSING) {
      throw new ConflictException(
        'IBP generation is already in progress for this influencer',
      );
    }

    const promptInstructions = await this.aiPromptsService.getIbpInstructions();

    await this.prisma.idealBrandProfile.upsert({
      where: { influencerId },
      create: {
        influencerId,
        status: IbpStatus.PROCESSING,
        targetSectors: [],
        excludedSectors: [],
        brandSize: [],
        markets: [],
        collaborationTypes: [],
        summary: '',
        alertSignals: [],
        desirableCriteria: [],
      },
      update: {
        status: IbpStatus.PROCESSING,
      },
    });

    await this.aiQueue.add(AI_JOBS.GENERATE_IDEAL_BRAND_PROFILE, {
      influencerId,
      promptInstructions,
    } satisfies GenerateIdealBrandProfileJobData);

    return {
      message,
      influencerId,
      status: IbpStatus.PROCESSING,
    };
  }

  private async ensureInfluencerExists(influencerId: string) {
    const influencer = await this.prisma.influencer.findUnique({
      where: { id: influencerId },
      select: { id: true },
    });

    if (!influencer) {
      throw new NotFoundException('Influencer not found');
    }
  }
}

export type IdealBrandProfileRecord = Prisma.IdealBrandProfileGetPayload<{
  select: typeof idealBrandProfileSelect;
}>;
