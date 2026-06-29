import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '../generated/prisma/client';

import { AI_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import {
  buildPaginationMeta,
  buildPrismaPagination,
} from '../common/utils/build-prisma-pagination';
import { ProfileStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInfluencerDto } from './dto/create-influencer.dto';
import {
  InfluencerSortBy,
  QueryInfluencersDto,
  SortOrder,
} from './dto/query-influencers.dto';
import { UpdateInfluencerDto } from './dto/update-influencer.dto';
import type { GenerateInfluencerProfileJobData } from './interfaces/commercial-profile.interface';

const influencerSelect = {
  id: true,
  name: true,
  instagram: true,
  tiktok: true,
  youtube: true,
  country: true,
  language: true,
  niche: true,
  subNiche: true,
  followers: true,
  engagement: true,
  email: true,
  mediaKitUrl: true,
  profileStatus: true,
  commercialProfile: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class InfluencersService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.AI) private readonly aiQueue: Queue,
  ) {}

  async findAll(query: QueryInfluencersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = buildPrismaPagination(page, limit);
    const where = this.buildWhereClause(query);
    const orderBy = this.buildOrderBy(query);

    const [data, total] = await Promise.all([
      this.prisma.influencer.findMany({
        where,
        select: influencerSelect,
        orderBy,
        skip,
        take,
      }),
      this.prisma.influencer.count({ where }),
    ]);

    return {
      data,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const influencer = await this.prisma.influencer.findUnique({
      where: { id },
      select: influencerSelect,
    });

    if (!influencer) {
      throw new NotFoundException('Influencer not found');
    }

    return influencer;
  }

  create(createInfluencerDto: CreateInfluencerDto) {
    return this.prisma.influencer.create({
      data: this.mapCreateData(createInfluencerDto),
      select: influencerSelect,
    });
  }

  async update(id: string, updateInfluencerDto: UpdateInfluencerDto) {
    await this.findOne(id);

    return this.prisma.influencer.update({
      where: { id },
      data: this.mapUpdateData(updateInfluencerDto),
      select: influencerSelect,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.influencer.delete({
      where: { id },
    });

    return { message: 'Influencer deleted successfully' };
  }

  async generateProfile(id: string) {
    const influencer = await this.findOne(id);

    if (influencer.profileStatus === ProfileStatus.PROCESSING) {
      throw new ConflictException(
        'Profile generation is already in progress for this influencer',
      );
    }

    await this.prisma.influencer.update({
      where: { id },
      data: { profileStatus: ProfileStatus.PROCESSING },
    });

    await this.aiQueue.add(AI_JOBS.GENERATE_INFLUENCER_PROFILE, {
      influencerId: id,
    } satisfies GenerateInfluencerProfileJobData);

    return {
      message: 'Profile generation job enqueued',
      influencerId: id,
      profileStatus: ProfileStatus.PROCESSING,
    };
  }

  private buildWhereClause(
    query: QueryInfluencersDto,
  ): Prisma.InfluencerWhereInput {
    const where: Prisma.InfluencerWhereInput = {};

    if (query.country) {
      where.country = query.country;
    }

    if (query.language) {
      where.language = query.language;
    }

    if (query.niche) {
      where.niche = query.niche;
    }

    if (query.subNiche) {
      where.subNiche = query.subNiche;
    }

    if (query.profileStatus) {
      where.profileStatus = query.profileStatus;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { instagram: { contains: query.search, mode: 'insensitive' } },
        { tiktok: { contains: query.search, mode: 'insensitive' } },
        { youtube: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private buildOrderBy(
    query: QueryInfluencersDto,
  ): Prisma.InfluencerOrderByWithRelationInput {
    const sortBy = query.sortBy ?? InfluencerSortBy.CREATED_AT;
    const sortOrder = query.sortOrder ?? SortOrder.DESC;

    return { [sortBy]: sortOrder };
  }

  private mapCreateData(
    dto: CreateInfluencerDto,
  ): Prisma.InfluencerCreateInput {
    return {
      name: dto.name,
      instagram: dto.instagram,
      tiktok: dto.tiktok,
      youtube: dto.youtube,
      country: dto.country,
      language: dto.language,
      niche: dto.niche,
      subNiche: dto.subNiche,
      followers: dto.followers,
      engagement: dto.engagement,
      email: dto.email,
      mediaKitUrl: dto.mediaKitUrl,
    };
  }

  private mapUpdateData(
    dto: UpdateInfluencerDto,
  ): Prisma.InfluencerUpdateInput {
    const data: Prisma.InfluencerUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    if (dto.instagram !== undefined) {
      data.instagram = dto.instagram;
    }

    if (dto.tiktok !== undefined) {
      data.tiktok = dto.tiktok;
    }

    if (dto.youtube !== undefined) {
      data.youtube = dto.youtube;
    }

    if (dto.country !== undefined) {
      data.country = dto.country;
    }

    if (dto.language !== undefined) {
      data.language = dto.language;
    }

    if (dto.niche !== undefined) {
      data.niche = dto.niche;
    }

    if (dto.subNiche !== undefined) {
      data.subNiche = dto.subNiche;
    }

    if (dto.followers !== undefined) {
      data.followers = dto.followers;
    }

    if (dto.engagement !== undefined) {
      data.engagement = dto.engagement;
    }

    if (dto.email !== undefined) {
      data.email = dto.email;
    }

    if (dto.mediaKitUrl !== undefined) {
      data.mediaKitUrl = dto.mediaKitUrl;
    }

    return data;
  }
}

export { influencerSelect };
