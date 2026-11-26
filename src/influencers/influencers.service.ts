import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { InfluencerDataOrigin } from '../generated/prisma/enums';

import {
  buildPaginationMeta,
  buildPrismaPagination,
} from '../common/utils/build-prisma-pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInfluencerDto } from './dto/create-influencer.dto';
import {
  InfluencerSortBy,
  QueryInfluencersDto,
  SortOrder,
} from './dto/query-influencers.dto';
import type { QuarterAssignmentDto } from './dto/quarter-assignment.dto';
import { UpdateInfluencerDto } from './dto/update-influencer.dto';
import {
  INFLUENCER_FIELD_KEYS,
  type InfluencerFieldKey,
} from './utils/influencer-field-keys';
import {
  buildProvenanceUpserts,
  canApplyExternalFieldUpdate,
  originByFieldKey,
  type ExternalFieldCandidate,
} from './utils/influencer-provenance';
import {
  resolveScalarFromResearch,
  sanitizeInstagramResearchEvidence,
} from './utils/instagram-research-evidence';
import {
  isValidNormalizedInstagramHandle,
  normalizeInstagramHandle,
} from './utils/normalize-instagram';

/** List/catalog select — additive fields keep legacy consumers compatible. */
export const influencerSelect = {
  id: true,
  name: true,
  instagram: true,
  instagramNormalized: true,
  tiktok: true,
  youtube: true,
  countries: true,
  language: true,
  niche: true,
  subNiche: true,
  niches: true,
  followers: true,
  engagement: true,
  email: true,
  outgoingEmail: true,
  mediaKitUrl: true,
  managerId: true,
  manager: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  quarterAssignments: {
    select: {
      id: true,
      year: true,
      quarter: true,
      assignedAt: true,
    },
    orderBy: [{ year: 'desc' }, { quarter: 'asc' }],
  },
  createdAt: true,
  updatedAt: true,
  idealBrandProfile: {
    select: {
      id: true,
      status: true,
      metadata: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.InfluencerSelect;

/** Detail select includes field provenance + Instagram research evidence. */
export const influencerDetailSelect = {
  ...influencerSelect,
  instagramResearchEvidence: true,
  fieldProvenances: {
    select: {
      fieldKey: true,
      origin: true,
      source: true,
      fetchedAt: true,
      updatedAt: true,
    },
    orderBy: { fieldKey: 'asc' },
  },
} satisfies Prisma.InfluencerSelect;

type TxClient = Prisma.TransactionClient;

@Injectable()
export class InfluencersService {
  constructor(private readonly prisma: PrismaService) {}

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
      select: influencerDetailSelect,
    });

    if (!influencer) {
      throw new NotFoundException('Influencer not found');
    }

    return influencer;
  }

  /**
   * Eligible managers = existing users. Does not create users or change roles.
   */
  findEligibleManagers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });
  }

  async create(createInfluencerDto: CreateInfluencerDto) {
    const resolved = this.resolveInstagram(createInfluencerDto.instagram);
    await this.assertInstagramAvailable(resolved.instagramNormalized);
    const managerId = await this.requireManagerIdForCreate(
      createInfluencerDto.managerId,
    );

    const niches = this.normalizeNiches(createInfluencerDto.niches);
    const countries = this.normalizeCountries(createInfluencerDto.countries);
    const quarters = createInfluencerDto.quarters ?? [];
    const researchEvidence = sanitizeInstagramResearchEvidence(
      createInfluencerDto.instagramResearch,
    );

    const followersFromResearch =
      researchEvidence?.normalized.followers ?? null;
    const emailFromResearch =
      researchEvidence?.normalized.emailAddress ?? null;

    const followers = resolveScalarFromResearch({
      dtoValue: createInfluencerDto.followers,
      researchValue: followersFromResearch,
    }) as number | undefined;
    const email = resolveScalarFromResearch({
      dtoValue: createInfluencerDto.email,
      researchValue: emailFromResearch,
    }) as string | undefined;

    const externalFromResearch: InfluencerFieldKey[] = [];
    if (
      researchEvidence &&
      createInfluencerDto.followers === undefined &&
      followers !== undefined
    ) {
      externalFromResearch.push(INFLUENCER_FIELD_KEYS.FOLLOWERS);
    }
    if (
      researchEvidence &&
      createInfluencerDto.email === undefined &&
      email !== undefined
    ) {
      externalFromResearch.push(INFLUENCER_FIELD_KEYS.EMAIL);
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.influencer.create({
        data: {
          name: createInfluencerDto.name,
          instagram: resolved.instagram,
          instagramNormalized: resolved.instagramNormalized,
          tiktok: createInfluencerDto.tiktok,
          youtube: createInfluencerDto.youtube,
          countries,
          language: createInfluencerDto.language,
          niche: createInfluencerDto.niche,
          subNiche: createInfluencerDto.subNiche,
          niches,
          followers,
          engagement: createInfluencerDto.engagement,
          email,
          outgoingEmail: createInfluencerDto.outgoingEmail,
          mediaKitUrl: createInfluencerDto.mediaKitUrl,
          managerId,
          instagramResearchEvidence: researchEvidence ?? undefined,
          quarterAssignments:
            quarters.length > 0
              ? {
                  create: quarters.map((q) => ({
                    year: q.year,
                    quarter: q.quarter,
                  })),
                }
              : undefined,
        },
        select: { id: true },
      });

      const manualKeys = this.collectProvidedFieldKeys(createInfluencerDto, {
        instagramProvided: true,
        nichesProvided: createInfluencerDto.niches !== undefined,
        countriesProvided: true,
      }).filter((key) => !externalFromResearch.includes(key));

      if (manualKeys.length > 0) {
        await this.upsertProvenances(tx, created.id, manualKeys, {
          origin: InfluencerDataOrigin.MANUAL,
        });
      }

      if (externalFromResearch.length > 0 && researchEvidence) {
        await this.upsertProvenances(tx, created.id, externalFromResearch, {
          origin: InfluencerDataOrigin.EXTERNAL,
          source: researchEvidence.source,
          fetchedAt: new Date(researchEvidence.fetchedAt),
        });
      }

      return tx.influencer.findUniqueOrThrow({
        where: { id: created.id },
        select: influencerDetailSelect,
      });
    });
  }

  async update(id: string, updateInfluencerDto: UpdateInfluencerDto) {
    const current = await this.prisma.influencer.findUnique({
      where: { id },
      select: {
        ...influencerDetailSelect,
        fieldProvenances: { select: { fieldKey: true, origin: true } },
      },
    });

    if (!current) {
      throw new NotFoundException('Influencer not found');
    }

    if (updateInfluencerDto.managerId !== undefined) {
      await this.assertManagerExists(updateInfluencerDto.managerId);
    }

    let nextInstagram: string | undefined;
    let nextNormalized: string | null | undefined;

    if (updateInfluencerDto.instagram !== undefined) {
      const resolved = this.resolveInstagram(updateInfluencerDto.instagram);
      await this.assertInstagramAvailable(resolved.instagramNormalized, id);
      nextInstagram = resolved.instagram;
      nextNormalized = resolved.instagramNormalized;
    }

    const data: Prisma.InfluencerUpdateInput = {};
    const changedKeys: InfluencerFieldKey[] = [];

    const trackScalar = <K extends InfluencerFieldKey>(
      key: K,
      incoming: unknown,
      currentValue: unknown,
      assign: () => void,
    ) => {
      if (incoming === undefined) {
        return;
      }
      assign();
      if (!this.valuesEqual(incoming, currentValue)) {
        changedKeys.push(key);
      }
    };

    trackScalar(
      INFLUENCER_FIELD_KEYS.NAME,
      updateInfluencerDto.name,
      current.name,
      () => {
        data.name = updateInfluencerDto.name!;
      },
    );

    if (updateInfluencerDto.instagram !== undefined) {
      data.instagram = nextInstagram;
      data.instagramNormalized = nextNormalized;
      if (
        nextInstagram !== current.instagram ||
        nextNormalized !== current.instagramNormalized
      ) {
        changedKeys.push(INFLUENCER_FIELD_KEYS.INSTAGRAM);
      }
    }

    trackScalar(
      INFLUENCER_FIELD_KEYS.TIKTOK,
      updateInfluencerDto.tiktok,
      current.tiktok,
      () => {
        data.tiktok = updateInfluencerDto.tiktok;
      },
    );

    trackScalar(
      INFLUENCER_FIELD_KEYS.YOUTUBE,
      updateInfluencerDto.youtube,
      current.youtube,
      () => {
        data.youtube = updateInfluencerDto.youtube;
      },
    );

    if (updateInfluencerDto.countries !== undefined) {
      const countries = this.normalizeCountries(updateInfluencerDto.countries);
      data.countries = countries;
      if (!this.nichesEqual(countries, current.countries)) {
        changedKeys.push(INFLUENCER_FIELD_KEYS.COUNTRIES);
      }
    }

    trackScalar(
      INFLUENCER_FIELD_KEYS.LANGUAGE,
      updateInfluencerDto.language,
      current.language,
      () => {
        data.language = updateInfluencerDto.language;
      },
    );

    trackScalar(
      INFLUENCER_FIELD_KEYS.NICHE,
      updateInfluencerDto.niche,
      current.niche,
      () => {
        data.niche = updateInfluencerDto.niche;
      },
    );

    trackScalar(
      INFLUENCER_FIELD_KEYS.SUB_NICHE,
      updateInfluencerDto.subNiche,
      current.subNiche,
      () => {
        data.subNiche = updateInfluencerDto.subNiche;
      },
    );

    if (updateInfluencerDto.niches !== undefined) {
      const niches = this.normalizeNiches(updateInfluencerDto.niches);
      data.niches = niches;
      if (!this.nichesEqual(niches, current.niches)) {
        changedKeys.push(INFLUENCER_FIELD_KEYS.NICHES);
      }
    }

    trackScalar(
      INFLUENCER_FIELD_KEYS.FOLLOWERS,
      updateInfluencerDto.followers,
      current.followers,
      () => {
        data.followers = updateInfluencerDto.followers;
      },
    );

    if (updateInfluencerDto.engagement !== undefined) {
      data.engagement = updateInfluencerDto.engagement;
      const currentEngagement =
        current.engagement === null || current.engagement === undefined
          ? null
          : Number(current.engagement);
      if (currentEngagement !== updateInfluencerDto.engagement) {
        changedKeys.push(INFLUENCER_FIELD_KEYS.ENGAGEMENT);
      }
    }

    trackScalar(
      INFLUENCER_FIELD_KEYS.EMAIL,
      updateInfluencerDto.email,
      current.email,
      () => {
        data.email = updateInfluencerDto.email;
      },
    );

    trackScalar(
      INFLUENCER_FIELD_KEYS.OUTGOING_EMAIL,
      updateInfluencerDto.outgoingEmail,
      current.outgoingEmail,
      () => {
        data.outgoingEmail = updateInfluencerDto.outgoingEmail;
      },
    );

    trackScalar(
      INFLUENCER_FIELD_KEYS.MEDIA_KIT_URL,
      updateInfluencerDto.mediaKitUrl,
      current.mediaKitUrl,
      () => {
        data.mediaKitUrl = updateInfluencerDto.mediaKitUrl;
      },
    );

    if (updateInfluencerDto.managerId !== undefined) {
      data.manager =
        updateInfluencerDto.managerId === null
          ? { disconnect: true }
          : { connect: { id: updateInfluencerDto.managerId } };
      if (updateInfluencerDto.managerId !== current.managerId) {
        changedKeys.push(INFLUENCER_FIELD_KEYS.MANAGER_ID);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.influencer.update({
        where: { id },
        data,
      });

      if (updateInfluencerDto.quarters !== undefined) {
        await this.syncQuarterAssignments(tx, id, updateInfluencerDto.quarters);
      }

      if (changedKeys.length > 0) {
        await this.upsertProvenances(tx, id, changedKeys, {
          origin: InfluencerDataOrigin.MANUAL,
        });
      }

      return tx.influencer.findUniqueOrThrow({
        where: { id },
        select: influencerDetailSelect,
      });
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.influencer.delete({
      where: { id },
    });

    return { message: 'Influencer deleted successfully' };
  }

  /**
   * Merge helper for EXTERNAL integrations (Bright Data Instagram research).
   * Does not persist — callers apply via `applyExternalFieldPatch`.
   */
  planExternalFieldMerge(params: {
    currentValues: Record<string, unknown>;
    provenances: Array<{ fieldKey: string; origin: InfluencerDataOrigin }>;
    candidates: ExternalFieldCandidate<unknown>[];
  }): {
    patch: Record<string, unknown>;
    provenanceKeys: InfluencerFieldKey[];
  } {
    const origins = originByFieldKey(params.provenances);
    const patch: Record<string, unknown> = {};
    const provenanceKeys: InfluencerFieldKey[] = [];

    for (const candidate of params.candidates) {
      if (
        !canApplyExternalFieldUpdate({
          origin: origins.get(candidate.fieldKey),
          value: candidate.value,
        })
      ) {
        continue;
      }

      const currentValue = params.currentValues[candidate.fieldKey];
      if (this.valuesEqual(candidate.value, currentValue)) {
        continue;
      }

      patch[candidate.fieldKey] = candidate.value;
      provenanceKeys.push(candidate.fieldKey);
    }

    return { patch, provenanceKeys };
  }

  /**
   * Persists EXTERNAL field patch + provenance (HU-TM-003).
   * Whitelists known influencer scalar fields only.
   */
  async applyExternalFieldPatch(params: {
    influencerId: string;
    patch: Record<string, unknown>;
    provenanceKeys: InfluencerFieldKey[];
    source: string;
    fetchedAt: Date;
  }) {
    await this.findOne(params.influencerId);

    const data: Prisma.InfluencerUpdateInput = {};
    if (
      Object.prototype.hasOwnProperty.call(
        params.patch,
        INFLUENCER_FIELD_KEYS.NAME,
      )
    ) {
      data.name = String(params.patch[INFLUENCER_FIELD_KEYS.NAME]);
    }
    if (
      Object.prototype.hasOwnProperty.call(
        params.patch,
        INFLUENCER_FIELD_KEYS.FOLLOWERS,
      )
    ) {
      data.followers = Number(params.patch[INFLUENCER_FIELD_KEYS.FOLLOWERS]);
    }
    if (
      Object.prototype.hasOwnProperty.call(
        params.patch,
        INFLUENCER_FIELD_KEYS.EMAIL,
      )
    ) {
      data.email = String(params.patch[INFLUENCER_FIELD_KEYS.EMAIL]);
    }

    return this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.influencer.update({
          where: { id: params.influencerId },
          data,
        });
      }

      if (params.provenanceKeys.length > 0) {
        await this.upsertProvenances(
          tx,
          params.influencerId,
          params.provenanceKeys,
          {
            origin: InfluencerDataOrigin.EXTERNAL,
            source: params.source,
            fetchedAt: params.fetchedAt,
          },
        );
      }

      return tx.influencer.findUniqueOrThrow({
        where: { id: params.influencerId },
        select: influencerDetailSelect,
      });
    });
  }

  private buildWhereClause(
    query: QueryInfluencersDto,
  ): Prisma.InfluencerWhereInput {
    const where: Prisma.InfluencerWhereInput = {};

    if (query.country) {
      where.countries = { has: query.country.trim().toUpperCase() };
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

    if (query.niches) {
      where.niches = { has: query.niches };
    }

    if (query.managerId) {
      where.managerId = query.managerId;
    }

    if (query.year !== undefined || query.quarter !== undefined) {
      where.quarterAssignments = {
        some: {
          ...(query.year !== undefined ? { year: query.year } : {}),
          ...(query.quarter !== undefined ? { quarter: query.quarter } : {}),
        },
      };
    }

    if (query.ibpStatus) {
      where.idealBrandProfile = {
        status: query.ibpStatus,
      };
    }

    if (query.search) {
      const search = query.search.trim();
      const normalizedSearch = normalizeInstagramHandle(search);
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { instagram: { contains: search, mode: 'insensitive' } },
        ...(normalizedSearch
          ? [
              {
                instagramNormalized: {
                  contains: normalizedSearch,
                  mode: 'insensitive' as const,
                },
              },
            ]
          : []),
        { tiktok: { contains: search, mode: 'insensitive' } },
        { youtube: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { outgoingEmail: { contains: search, mode: 'insensitive' } },
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

  private resolveInstagram(raw: string): {
    instagram: string;
    instagramNormalized: string;
  } {
    const instagramNormalized = normalizeInstagramHandle(raw);

    if (!isValidNormalizedInstagramHandle(instagramNormalized)) {
      throw new BadRequestException('Invalid Instagram handle');
    }

    return {
      instagram: `@${instagramNormalized}`,
      instagramNormalized,
    };
  }

  private async assertInstagramAvailable(
    instagramNormalized: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.influencer.findUnique({
      where: { instagramNormalized },
      select: { id: true },
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        'An influencer with this Instagram handle already exists',
      );
    }
  }

  /**
   * Create-only: manager is mandatory. Does not change update semantics
   * where `null` may clear the association via `assertManagerExists`.
   */
  private async requireManagerIdForCreate(
    managerId: string | null | undefined,
  ): Promise<string> {
    if (
      managerId === undefined ||
      managerId === null ||
      managerId.trim() === ''
    ) {
      throw new BadRequestException('Manager is required');
    }

    const normalizedManagerId = managerId.trim();
    await this.assertManagerExists(normalizedManagerId);
    return normalizedManagerId;
  }

  /**
   * Shared existence check. Allows `undefined`/`null` (no-op) for update flows
   * that omit manager or explicitly disconnect with `null`.
   */
  private async assertManagerExists(managerId: string | null | undefined) {
    if (managerId === undefined || managerId === null) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException('Manager user not found');
    }
  }

  private normalizeNiches(niches: string[] | undefined): string[] {
    if (!niches) {
      return [];
    }

    const seen = new Set<string>();
    const result: string[] = [];

    for (const raw of niches) {
      const value = raw.trim();
      if (!value) {
        continue;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(value);
    }

    return result;
  }

  private normalizeCountries(countries: string[] | undefined): string[] {
    if (!countries) {
      return [];
    }

    const seen = new Set<string>();
    const result: string[] = [];

    for (const raw of countries) {
      const value = raw.trim().toUpperCase();
      if (!value) {
        continue;
      }
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      result.push(value);
    }

    return result;
  }

  private nichesEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const left = [...a].map((v) => v.toLowerCase()).sort();
    const right = [...b].map((v) => v.toLowerCase()).sort();
    return left.every((v, i) => v === right[i]);
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }
    if (a == null && b == null) {
      return true;
    }
    return false;
  }

  private collectProvidedFieldKeys(
    dto: CreateInfluencerDto,
    flags: {
      instagramProvided: boolean;
      nichesProvided: boolean;
      countriesProvided: boolean;
    },
  ): InfluencerFieldKey[] {
    const keys: InfluencerFieldKey[] = [INFLUENCER_FIELD_KEYS.NAME];

    if (flags.instagramProvided) {
      keys.push(INFLUENCER_FIELD_KEYS.INSTAGRAM);
    }
    if (dto.tiktok !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.TIKTOK);
    }
    if (dto.youtube !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.YOUTUBE);
    }
    if (flags.countriesProvided) {
      keys.push(INFLUENCER_FIELD_KEYS.COUNTRIES);
    }
    if (dto.language !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.LANGUAGE);
    }
    if (dto.niche !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.NICHE);
    }
    if (dto.subNiche !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.SUB_NICHE);
    }
    if (flags.nichesProvided) {
      keys.push(INFLUENCER_FIELD_KEYS.NICHES);
    }
    if (dto.followers !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.FOLLOWERS);
    }
    if (dto.engagement !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.ENGAGEMENT);
    }
    if (dto.email !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.EMAIL);
    }
    if (dto.outgoingEmail !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.OUTGOING_EMAIL);
    }
    if (dto.mediaKitUrl !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.MEDIA_KIT_URL);
    }
    if (dto.managerId !== undefined) {
      keys.push(INFLUENCER_FIELD_KEYS.MANAGER_ID);
    }

    return keys;
  }

  private async upsertProvenances(
    tx: TxClient,
    influencerId: string,
    fieldKeys: InfluencerFieldKey[],
    options: {
      origin: InfluencerDataOrigin;
      source?: string;
      fetchedAt?: Date;
    },
  ) {
    const rows = buildProvenanceUpserts({
      influencerId,
      fieldKeys,
      origin: options.origin,
      source: options.source,
      fetchedAt: options.fetchedAt,
    });

    for (const row of rows) {
      await tx.influencerFieldProvenance.upsert({
        where: {
          influencerId_fieldKey: {
            influencerId: row.influencerId,
            fieldKey: row.fieldKey,
          },
        },
        create: row,
        update: {
          origin: row.origin,
          source: row.source,
          fetchedAt: row.fetchedAt,
        },
      });
    }
  }

  /**
   * Additive sync: creates missing year+quarter pairs only.
   * Never deletes historical assignments (HU-TM-002).
   * Dedupes against existing rows and within the incoming payload.
   */
  private async syncQuarterAssignments(
    tx: TxClient,
    influencerId: string,
    quarters: QuarterAssignmentDto[],
  ) {
    const desired = new Map(
      quarters.map((q) => [`${q.year}:${q.quarter}`, q] as const),
    );

    const existing = await tx.influencerQuarterAssignment.findMany({
      where: { influencerId },
      select: { id: true, year: true, quarter: true },
    });

    const existingKeys = new Set(
      existing.map((row) => `${row.year}:${row.quarter}`),
    );

    const toCreate = [...desired.values()].filter(
      (q) => !existingKeys.has(`${q.year}:${q.quarter}`),
    );

    if (toCreate.length > 0) {
      await tx.influencerQuarterAssignment.createMany({
        data: toCreate.map((q) => ({
          influencerId,
          year: q.year,
          quarter: q.quarter,
        })),
      });
    }
  }
}
