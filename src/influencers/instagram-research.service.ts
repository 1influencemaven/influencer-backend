import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client';
import { InfluencerDataOrigin } from '../generated/prisma/enums';

import { BrightDataDatasetClient } from '../integrations/brightdata/brightdata-dataset.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  influencerDetailSelect,
  InfluencersService,
} from './influencers.service';
import {
  INFLUENCER_FIELD_KEYS,
  type InfluencerFieldKey,
} from './utils/influencer-field-keys';
import { originByFieldKey } from './utils/influencer-provenance';
import {
  buildInstagramUsernameLookup,
  type InstagramUsernameLookupNormalized,
} from './utils/instagram-username-lookup';
import {
  mapInstagramProfileRow,
  skippedManualKeys,
} from './utils/map-instagram-profile-row';
import {
  isValidNormalizedInstagramHandle,
  normalizeInstagramHandle,
} from './utils/normalize-instagram';

export const DEFAULT_INSTAGRAM_PROFILE_DATASET_ID = 'gd_l1vikfch901nx3by4';

export type InstagramResearchOutcomeCode =
  | 'UPDATED'
  | 'NO_CHANGES'
  | 'PROFILE_PRIVATE'
  | 'PROFILE_NOT_FOUND'
  | 'INCOMPLETE_RESPONSE'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'NOT_CONFIGURED';

export type InstagramResearchResponse = {
  influencer: Prisma.InfluencerGetPayload<{
    select: typeof influencerDetailSelect;
  }>;
  research: {
    outcome: InstagramResearchOutcomeCode;
    handle: string;
    profileUrl: string;
    source: string;
    fetchedAt: string;
    updatedFields: InfluencerFieldKey[];
    skippedManualFields: InfluencerFieldKey[];
    message?: string;
  };
};

/** Read-only username lookup (HU-TM-003 phase 1). Never persists. */
export type InstagramUsernameResearchResponse = {
  research: {
    outcome:
      | 'FOUND'
      | 'PROFILE_PRIVATE'
      | 'PROFILE_NOT_FOUND'
      | 'INCOMPLETE_RESPONSE';
    queriedUsername: string;
    handleNormalized: string;
    profileUrl: string;
    source: string;
    fetchedAt: string;
    /** Always false in phase 1 — lookup does not write PostgreSQL. */
    persisted: false;
  };
  normalized: InstagramUsernameLookupNormalized;
  provider: Record<string, unknown>;
};

@Injectable()
export class InstagramResearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly datasetClient: BrightDataDatasetClient,
    private readonly influencersService: InfluencersService,
  ) {}

  /**
   * Phase 1: research Instagram by username without creating/updating influencers.
   * Reuses BrightDataDatasetClient; does not touch Prisma writes.
   */
  async researchByUsername(
    usernameInput: string,
  ): Promise<InstagramUsernameResearchResponse> {
    const handleNormalized = this.resolveUsernameInput(usernameInput);
    const profileUrl = `https://www.instagram.com/${handleNormalized}/`;
    const datasetId =
      this.configService
        .get<string>('BRIGHTDATA_INSTAGRAM_PROFILE_DATASET_ID')
        ?.trim() || DEFAULT_INSTAGRAM_PROFILE_DATASET_ID;
    const source = `brightdata:instagram:${datasetId}`;
    const fetchedAt = new Date();

    if (!this.datasetClient.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'NOT_CONFIGURED' satisfies InstagramResearchOutcomeCode,
        message: 'Bright Data is not configured for Instagram research',
      });
    }

    const scrape = await this.datasetClient.scrapeByUrl({
      datasetId,
      url: profileUrl,
    });

    if (!scrape.ok || !scrape.row) {
      this.throwProviderFailure(scrape.errorCode, scrape.error);
    }

    const lookup = buildInstagramUsernameLookup({
      row: scrape.row,
      handleNormalized,
      requestedProfileUrl: profileUrl,
    });

    if (lookup.outcome === 'PROFILE_NOT_FOUND') {
      throw new NotFoundException({
        code: 'PROFILE_NOT_FOUND' satisfies InstagramResearchOutcomeCode,
        message: 'Instagram profile was not found',
      });
    }

    if (lookup.outcome === 'INCOMPLETE_RESPONSE') {
      throw new UnprocessableEntityException({
        code: 'INCOMPLETE_RESPONSE' satisfies InstagramResearchOutcomeCode,
        message: 'Instagram provider returned an incomplete profile',
      });
    }

    return {
      research: {
        outcome: lookup.outcome,
        queriedUsername: usernameInput.trim(),
        handleNormalized: lookup.handleNormalized,
        profileUrl: lookup.profileUrl,
        source,
        fetchedAt: fetchedAt.toISOString(),
        persisted: false,
      },
      normalized: lookup.normalized,
      provider: lookup.provider,
    };
  }

  async researchByInfluencerId(
    influencerId: string,
  ): Promise<InstagramResearchResponse> {
    const current = await this.influencersService.findOne(influencerId);

    const handle = this.resolveResearchHandle(current);
    const profileUrl = `https://www.instagram.com/${handle}/`;
    const datasetId =
      this.configService
        .get<string>('BRIGHTDATA_INSTAGRAM_PROFILE_DATASET_ID')
        ?.trim() || DEFAULT_INSTAGRAM_PROFILE_DATASET_ID;
    const source = `brightdata:instagram:${datasetId}`;
    const fetchedAt = new Date();

    if (!this.datasetClient.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'NOT_CONFIGURED' satisfies InstagramResearchOutcomeCode,
        message: 'Bright Data is not configured for Instagram research',
      });
    }

    const scrape = await this.datasetClient.scrapeByUrl({
      datasetId,
      url: profileUrl,
    });

    if (!scrape.ok || !scrape.row) {
      this.throwProviderFailure(scrape.errorCode, scrape.error);
    }

    const mapped = mapInstagramProfileRow(scrape.row);

    if (mapped.outcome === 'not_found') {
      throw new NotFoundException({
        code: 'PROFILE_NOT_FOUND' satisfies InstagramResearchOutcomeCode,
        message: 'Instagram profile was not found',
      });
    }

    if (mapped.outcome === 'private') {
      return this.buildSoftResponse(current, {
        outcome: 'PROFILE_PRIVATE',
        handle,
        profileUrl: mapped.profileUrl ?? profileUrl,
        source,
        fetchedAt,
        updatedFields: [],
        skippedManualFields: [],
        message: 'Instagram profile is private; no fields were updated',
      });
    }

    if (mapped.outcome === 'incomplete') {
      throw new UnprocessableEntityException({
        code: 'INCOMPLETE_RESPONSE' satisfies InstagramResearchOutcomeCode,
        message: 'Instagram provider returned an incomplete profile',
      });
    }

    await this.assertAccountNotDuplicated(
      influencerId,
      mapped.accountNormalized,
      handle,
    );

    const origins = originByFieldKey(current.fieldProvenances ?? []);
    const skippedManual = skippedManualKeys(mapped.candidates, origins);

    const plan = this.influencersService.planExternalFieldMerge({
      currentValues: {
        [INFLUENCER_FIELD_KEYS.NAME]: current.name,
        [INFLUENCER_FIELD_KEYS.FOLLOWERS]: current.followers,
        [INFLUENCER_FIELD_KEYS.EMAIL]: current.email,
      },
      provenances: current.fieldProvenances ?? [],
      candidates: mapped.candidates,
    });

    if (Object.keys(plan.patch).length === 0) {
      return this.buildSoftResponse(current, {
        outcome: 'NO_CHANGES',
        handle,
        profileUrl: mapped.profileUrl ?? profileUrl,
        source,
        fetchedAt,
        updatedFields: [],
        skippedManualFields: skippedManual,
        message:
          skippedManual.length > 0
            ? 'No fields updated; manual values were preserved'
            : 'Provider data matched existing values',
      });
    }

    const influencer = await this.influencersService.applyExternalFieldPatch({
      influencerId,
      patch: plan.patch,
      provenanceKeys: plan.provenanceKeys,
      source,
      fetchedAt,
    });

    return {
      influencer,
      research: {
        outcome: 'UPDATED',
        handle,
        profileUrl: mapped.profileUrl ?? profileUrl,
        source,
        fetchedAt: fetchedAt.toISOString(),
        updatedFields: plan.provenanceKeys,
        skippedManualFields: skippedManual,
      },
    };
  }

  private resolveUsernameInput(usernameInput: string): string {
    const normalized = normalizeInstagramHandle(usernameInput ?? '');
    if (!isValidNormalizedInstagramHandle(normalized)) {
      throw new BadRequestException({
        code: 'INVALID_INSTAGRAM',
        message: 'Instagram username is invalid',
      });
    }
    return normalized;
  }

  private resolveResearchHandle(current: {
    instagram: string | null;
    instagramNormalized: string | null;
  }): string {
    const fromNormalized = current.instagramNormalized?.trim().toLowerCase();
    if (fromNormalized && isValidNormalizedInstagramHandle(fromNormalized)) {
      return fromNormalized;
    }

    if (current.instagram) {
      try {
        const normalized = normalizeInstagramHandle(current.instagram);
        if (isValidNormalizedInstagramHandle(normalized)) {
          return normalized;
        }
      } catch {
        // fall through
      }
    }

    throw new BadRequestException({
      code: 'INVALID_INSTAGRAM',
      message: 'Influencer has no valid Instagram handle to research',
    });
  }

  private async assertAccountNotDuplicated(
    influencerId: string,
    accountNormalized: string | undefined,
    researchHandle: string,
  ) {
    if (!accountNormalized || accountNormalized === researchHandle) {
      return;
    }

    const conflict = await this.prisma.influencer.findFirst({
      where: {
        instagramNormalized: accountNormalized,
        NOT: { id: influencerId },
      },
      select: { id: true },
    });

    if (conflict) {
      throw new ConflictException({
        code: 'INSTAGRAM_DUPLICATE',
        message:
          'Provider account matches another talent Instagram handle; research aborted',
      });
    }
  }

  private throwProviderFailure(
    errorCode: string | undefined,
    error: string | undefined,
  ): never {
    if (errorCode === 'timeout') {
      throw new GatewayTimeoutException({
        code: 'PROVIDER_TIMEOUT' satisfies InstagramResearchOutcomeCode,
        message: 'Bright Data Instagram research timed out',
      });
    }

    if (errorCode === 'not_configured') {
      throw new ServiceUnavailableException({
        code: 'NOT_CONFIGURED' satisfies InstagramResearchOutcomeCode,
        message: 'Bright Data is not configured for Instagram research',
      });
    }

    if (errorCode === 'empty_snapshot') {
      throw new NotFoundException({
        code: 'PROFILE_NOT_FOUND' satisfies InstagramResearchOutcomeCode,
        message: 'Instagram profile was not found',
      });
    }

    throw new ServiceUnavailableException({
      code: 'PROVIDER_ERROR' satisfies InstagramResearchOutcomeCode,
      message: error ?? 'Bright Data Instagram research failed',
    });
  }

  private buildSoftResponse(
    influencer: InstagramResearchResponse['influencer'],
    research: Omit<InstagramResearchResponse['research'], 'fetchedAt'> & {
      fetchedAt: Date;
    },
  ): InstagramResearchResponse {
    return {
      influencer,
      research: {
        ...research,
        fetchedAt: research.fetchedAt.toISOString(),
      },
    };
  }
}
