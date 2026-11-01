import { createHash, randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_CONTRACT_VERSION,
  type AiExecutionRequest,
} from '@influence-maven/ai-contracts';
import { Queue } from 'bullmq';

import {
  AI_EXECUTION_JOBS,
  AI_EXECUTION_QUEUES,
} from './ai-execution.queues';
import { mapInfluencerToIbpInput } from './map-influencer-to-ibp-input';

type InfluencerLike = Parameters<typeof mapInfluencerToIbpInput>[0];

export type PublishIbpExecutionParams = {
  influencer: InfluencerLike;
  userId: string;
  promptInstructions: string;
  actorRole?: 'USER' | 'ADMIN';
  locale?: 'es' | 'en';
};

@Injectable()
export class AiExecutionPublisherService {
  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(AI_EXECUTION_QUEUES.REQUESTS)
    private readonly requestsQueue: Queue,
  ) {}

  async publishIbpGeneration(
    params: PublishIbpExecutionParams,
  ): Promise<{ executionId: string; correlationId: string }> {
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const business = params.promptInstructions;
    const businessHash = createHash('sha256')
      .update(business)
      .digest('hex')
      .slice(0, 16);

    const provider =
      this.configService.get<string>('AI_PROVIDER') ??
      (this.configService.get<string>('NODE_ENV') === 'production'
        ? 'anthropic'
        : 'ollama');

    const model =
      provider === 'anthropic'
        ? (this.configService.get<string>('ANTHROPIC_MODEL') ??
          'claude-sonnet-4-20250514')
        : (this.configService.get<string>('OLLAMA_MODEL') ?? 'llama3.2:3b');

    const configuration =
      provider === 'ollama' || provider === 'anthropic'
        ? {
            provider: provider as 'ollama' | 'anthropic',
            model,
          }
        : undefined;

    const request: AiExecutionRequest = {
      contractVersion: AI_CONTRACT_VERSION,
      executionId,
      correlationId,
      idempotencyKey: `ibp:${params.influencer.id}:${executionId}`,
      requestedAt: new Date().toISOString(),
      type: 'IBP_GENERATION',
      context: {
        userId: params.userId,
        influencerId: params.influencer.id,
        resourceId: params.influencer.id,
        resourceType: 'IDEAL_BRAND_PROFILE',
        locale: params.locale,
        actorRole: params.actorRole,
      },
      instructions: { business, businessHash },
      configuration,
      input: mapInfluencerToIbpInput(params.influencer),
    };

    await this.requestsQueue.add(AI_EXECUTION_JOBS.EXECUTE, request, {
      jobId: executionId,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });

    return { executionId, correlationId };
  }
}
