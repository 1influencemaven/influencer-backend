import {
  AI_CONTRACT_VERSION,
  parseAiExecutionRequest,
} from '@influence-maven/ai-contracts';

import { AiExecutionPublisherService } from './ai-execution-publisher.service';
import { AI_EXECUTION_JOBS } from './ai-execution.queues';

describe('AiExecutionPublisherService', () => {
  const influencer = { id: 'inf-1', name: 'Ada', niche: 'fitness' };

  function buildService(
    add: jest.Mock,
    getImpl?: (key: string) => unknown,
  ) {
    const configService = {
      get:
        getImpl ??
        ((key: string) => {
          if (key === 'AI_PROVIDER') return 'ollama';
          if (key === 'OLLAMA_MODEL') return 'llama3.2:3b';
          if (key === 'NODE_ENV') return 'development';
          return undefined;
        }),
    };
    return new AiExecutionPublisherService(
      configService as never,
      { add } as never,
    );
  }

  it('publishes a contract-valid IBP_GENERATION request on ai.execution.requests', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const service = buildService(add);

    const ids = await service.publishIbpGeneration({
      influencer,
      userId: 'user-1',
      promptInstructions: 'Build IBP',
      actorRole: 'ADMIN',
      locale: 'es',
    });

    expect(ids.executionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(ids.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, payload, opts] = add.mock.calls[0];
    expect(jobName).toBe(AI_EXECUTION_JOBS.EXECUTE);
    expect(opts.jobId).toBe(ids.executionId);
    expect(opts.jobId).not.toContain(':');
    expect(opts.removeOnComplete).toBe(1000);
    expect(opts.removeOnFail).toBe(5000);

    const parsed = parseAiExecutionRequest(payload);
    expect(parsed.contractVersion).toBe(AI_CONTRACT_VERSION);
    expect(parsed.type).toBe('IBP_GENERATION');
    expect(parsed.executionId).toBe(ids.executionId);
    expect(parsed.correlationId).toBe(ids.correlationId);
    expect(parsed.context).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        influencerId: 'inf-1',
        resourceId: 'inf-1',
        resourceType: 'IDEAL_BRAND_PROFILE',
        actorRole: 'ADMIN',
        locale: 'es',
      }),
    );
    expect(parsed.configuration).toEqual({
      provider: 'ollama',
      model: 'llama3.2:3b',
    });
    expect(parsed.instructions.business).toBe('Build IBP');
    expect(parsed.instructions.businessHash).toMatch(/^[a-f0-9]{16}$/);
    if (parsed.type === 'IBP_GENERATION') {
      expect(parsed.input.influencer).toEqual(
        expect.objectContaining({ id: 'inf-1', name: 'Ada', niche: 'fitness' }),
      );
    }
  });

  it('uses anthropic model when AI_PROVIDER=anthropic', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const service = buildService(add, (key) => {
      if (key === 'AI_PROVIDER') return 'anthropic';
      if (key === 'ANTHROPIC_MODEL') return 'claude-sonnet-4-20250514';
      return undefined;
    });

    await service.publishIbpGeneration({
      influencer,
      userId: 'user-1',
      promptInstructions: 'x',
    });

    const payload = add.mock.calls[0][1];
    expect(payload.configuration).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('defaults provider to ollama when AI_PROVIDER unset outside production', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const service = buildService(add, (key) => {
      if (key === 'NODE_ENV') return 'development';
      return undefined;
    });

    await service.publishIbpGeneration({
      influencer,
      userId: 'user-1',
      promptInstructions: 'x',
    });

    expect(add.mock.calls[0][1].configuration).toEqual({
      provider: 'ollama',
      model: 'llama3.2:3b',
    });
  });

  it('defaults provider to anthropic when AI_PROVIDER unset in production', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const service = buildService(add, (key) => {
      if (key === 'NODE_ENV') return 'production';
      return undefined;
    });

    await service.publishIbpGeneration({
      influencer,
      userId: 'user-1',
      promptInstructions: 'x',
    });

    expect(add.mock.calls[0][1].configuration).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('defaults OLLAMA_MODEL when provider is ollama and model env missing', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const service = buildService(add, (key) => {
      if (key === 'AI_PROVIDER') return 'ollama';
      return undefined;
    });

    await service.publishIbpGeneration({
      influencer,
      userId: 'user-1',
      promptInstructions: 'x',
    });

    expect(add.mock.calls[0][1].configuration.model).toBe('llama3.2:3b');
  });

  it('defaults ANTHROPIC_MODEL when provider is anthropic and model env missing', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const service = buildService(add, (key) => {
      if (key === 'AI_PROVIDER') return 'anthropic';
      return undefined;
    });

    await service.publishIbpGeneration({
      influencer,
      userId: 'user-1',
      promptInstructions: 'x',
    });

    expect(add.mock.calls[0][1].configuration.model).toBe(
      'claude-sonnet-4-20250514',
    );
  });

  it('omits configuration for unsupported provider (e.g. cursor)', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const service = buildService(add, (key) => {
      if (key === 'AI_PROVIDER') return 'cursor';
      return undefined;
    });

    await service.publishIbpGeneration({
      influencer,
      userId: 'user-1',
      promptInstructions: 'x',
    });

    expect(add.mock.calls[0][1].configuration).toBeUndefined();
  });

  it('propagates BullMQ/Redis add failures', async () => {
    const add = jest.fn().mockRejectedValue(new Error('ECONNREFUSED Redis'));
    const service = buildService(add);

    await expect(
      service.publishIbpGeneration({
        influencer,
        userId: 'user-1',
        promptInstructions: 'x',
      }),
    ).rejects.toThrow('ECONNREFUSED Redis');
  });

  it('keeps colon only in idempotencyKey payload, never in BullMQ jobId', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const service = buildService(add);

    const ids = await service.publishIbpGeneration({
      influencer,
      userId: 'user-1',
      promptInstructions: 'x',
    });

    const [ , payload, opts] = add.mock.calls[0];
    expect(payload.idempotencyKey).toContain(':');
    expect(opts.jobId).toBe(ids.executionId);
    expect(String(opts.jobId)).not.toMatch(/:/);
  });
});
