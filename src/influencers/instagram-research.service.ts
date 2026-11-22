import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '../generated/prisma/client';
import {
  InstagramResearchMode,
  InstagramResearchStatus,
} from '../generated/prisma/enums';

import { INSTAGRAM_RESEARCH_JOBS } from '../bullmq/job-types';
import { QUEUES } from '../bullmq/queue.constants';
import { BrightDataDatasetClient } from '../integrations/brightdata/brightdata-dataset.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  influencerDetailSelect,
  InfluencersService,
} from './influencers.service';
import {
  instagramResearchJobId,
  type InstagramResearchJobData,
} from './interfaces/instagram-research-job.interface';
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

export const instagramResearchRunSelect = {
  id: true,
  status: true,
  mode: true,
  username: true,
  handleNormalized: true,
  influencerId: true,
  result: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type InstagramResearchRunRecord = Prisma.InstagramResearchRunGetPayload<{
  select: typeof instagramResearchRunSelect;
}>;

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

/** Read-only username lookup (HU-TM-003 phase 1). Never persists Influencer. */
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
    /** Always false in phase 1 — lookup does not write Influencer. */
    persisted: false;
  };
  normalized: InstagramUsernameLookupNormalized;
  provider: Record<string, unknown>;
};

@Injectable()
export class InstagramResearchService {
  private readonly logger = new Logger(InstagramResearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly datasetClient: BrightDataDatasetClient,
    private readonly influencersService: InfluencersService,
    @InjectQueue(QUEUES.INSTAGRAM_RESEARCH)
    private readonly instagramResearchQueue: Queue,
  ) {}

  async enqueueByUsername(usernameInput: string) {
    const handleNormalized = this.resolveUsernameInput(usernameInput);
    this.assertProviderConfigured();

    const processing = await this.prisma.instagramResearchRun.findFirst({
      where: {
        mode: InstagramResearchMode.USERNAME,
        handleNormalized,
        status: InstagramResearchStatus.PROCESSING,
      },
      select: instagramResearchRunSelect,
      orderBy: { createdAt: 'desc' },
    });
    // Idempotent: keep FE polling the active run instead of 409.
    if (processing) {
      return processing;
    }

    const run = await this.prisma.instagramResearchRun.create({
      data: {
        status: InstagramResearchStatus.PROCESSING,
        mode: InstagramResearchMode.USERNAME,
        username: usernameInput.trim(),
        handleNormalized,
      },
      select: instagramResearchRunSelect,
    });

    await this.enqueueJob(
      run.id,
      INSTAGRAM_RESEARCH_JOBS.RESEARCH_BY_USERNAME,
    );

    return run;
  }

  async enqueueByInfluencerId(influencerId: string) {
    const current = await this.influencersService.findOne(influencerId);
    const handleNormalized = this.resolveResearchHandle(current);
    this.assertProviderConfigured();

    const processing = await this.prisma.instagramResearchRun.findFirst({
      where: {
        mode: InstagramResearchMode.INFLUENCER,
        influencerId,
        status: InstagramResearchStatus.PROCESSING,
      },
      select: instagramResearchRunSelect,
      orderBy: { createdAt: 'desc' },
    });
    // Idempotent: keep FE polling the active run instead of 409.
    if (processing) {
      return processing;
    }

    const run = await this.prisma.instagramResearchRun.create({
      data: {
        status: InstagramResearchStatus.PROCESSING,
        mode: InstagramResearchMode.INFLUENCER,
        username: current.instagram,
        handleNormalized,
        influencerId,
      },
      select: instagramResearchRunSelect,
    });

    await this.enqueueJob(
      run.id,
      INSTAGRAM_RESEARCH_JOBS.RESEARCH_BY_INFLUENCER,
    );

    return run;
  }

  async getRun(runId: string): Promise<InstagramResearchRunRecord> {
    const run = await this.prisma.instagramResearchRun.findUnique({
      where: { id: runId },
      select: instagramResearchRunSelect,
    });
    if (!run) {
      throw new NotFoundException('Instagram research run not found');
    }
    return run;
  }

  /** Active PROCESSING run for a talent, if any (resume UI after reload). */
  async getActiveRunForInfluencer(
    influencerId: string,
  ): Promise<InstagramResearchRunRecord | null> {
    await this.influencersService.findOne(influencerId);
    return this.prisma.instagramResearchRun.findFirst({
      where: {
        mode: InstagramResearchMode.INFLUENCER,
        influencerId,
        status: InstagramResearchStatus.PROCESSING,
      },
      select: instagramResearchRunSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Worker entry: scrape + persist COMPLETED/FAILED on the run.
   * Business failures are written as FAILED and do not rethrow (no BullMQ retry).
   */
  async executeRun(runId: string): Promise<void> {
    const run = await this.prisma.instagramResearchRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        mode: true,
        username: true,
        handleNormalized: true,
        influencerId: true,
      },
    });

    if (!run) {
      this.logger.warn(
        JSON.stringify({
          event: 'instagram_research_run_missing',
          runId,
        }),
      );
      return;
    }

    if (run.status !== InstagramResearchStatus.PROCESSING) {
      this.logger.log(
        JSON.stringify({
          event: 'instagram_research_run_skip_terminal',
          runId,
          status: run.status,
        }),
      );
      return;
    }

    try {
      if (run.mode === InstagramResearchMode.USERNAME) {
        const username = run.username ?? run.handleNormalized;
        if (!username) {
          throw new BadRequestException({
            code: 'INVALID_INSTAGRAM',
            message: 'Instagram username is missing on research run',
          });
        }
        const result = await this.researchByUsername(username);
        await this.prisma.instagramResearchRun.update({
          where: { id: runId },
          data: {
            status: InstagramResearchStatus.COMPLETED,
            result: result as unknown as Prisma.InputJsonValue,
            errorCode: null,
            errorMessage: null,
          },
        });
        return;
      }

      if (!run.influencerId) {
        throw new BadRequestException({
          code: 'INVALID_INSTAGRAM',
          message: 'Influencer id is missing on research run',
        });
      }

      const result = await this.researchByInfluencerId(run.influencerId);
      await this.prisma.instagramResearchRun.update({
        where: { id: runId },
        data: {
          status: InstagramResearchStatus.COMPLETED,
          result: result as unknown as Prisma.InputJsonValue,
          errorCode: null,
          errorMessage: null,
        },
      });
    } catch (error) {
      const { code, message } = this.extractFailure(error);
      this.logger.warn(
        JSON.stringify({
          event: 'instagram_research_run_failed',
          runId,
          errorCode: code,
          errorMessage: message,
        }),
      );
      await this.prisma.instagramResearchRun.update({
        where: { id: runId },
        data: {
          status: InstagramResearchStatus.FAILED,
          errorCode: code,
          errorMessage: message,
        },
      });
    }
  }

  /**
   * Phase 1 scrape by username (no Influencer write). Used by the worker.
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

  private async enqueueJob(
    runId: string,
    jobName: (typeof INSTAGRAM_RESEARCH_JOBS)[keyof typeof INSTAGRAM_RESEARCH_JOBS],
  ) {
    try {
      await this.instagramResearchQueue.add(
        jobName,
        { runId } satisfies InstagramResearchJobData,
        {
          jobId: instagramResearchJobId(runId),
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        JSON.stringify({
          event: 'instagram_research_enqueue_failed',
          runId,
          jobName,
          errorMessage: message,
        }),
      );
      await this.prisma.instagramResearchRun.update({
        where: { id: runId },
        data: {
          status: InstagramResearchStatus.FAILED,
          errorCode: 'ENQUEUE_FAILED',
          errorMessage: message,
        },
      });
      throw new ConflictException(
        `Failed to enqueue Instagram research job for run ${runId}`,
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'instagram_research_enqueued',
        runId,
        queue: QUEUES.INSTAGRAM_RESEARCH,
        job: jobName,
      }),
    );
  }

  private assertProviderConfigured() {
    if (!this.datasetClient.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'NOT_CONFIGURED' satisfies InstagramResearchOutcomeCode,
        message: 'Bright Data is not configured for Instagram research',
      });
    }
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

  private extractFailure(error: unknown): {
    code: string;
    message: string;
  } {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null) {
        const body = response as Record<string, unknown>;
        const code =
          typeof body.code === 'string' ? body.code : 'PROVIDER_ERROR';
        const message =
          typeof body.message === 'string'
            ? body.message
            : Array.isArray(body.message)
              ? body.message.map(String).join(', ')
              : error.message;
        return { code, message };
      }
      return { code: 'PROVIDER_ERROR', message: error.message };
    }

    if (error instanceof Error) {
      return { code: 'PROVIDER_ERROR', message: error.message };
    }

    return { code: 'PROVIDER_ERROR', message: String(error) };
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
