jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import { IbpStatus } from '../generated/prisma/enums';
import { AI_EXECUTION_JOBS } from './ai-execution.queues';
import { AiExecutionResultProcessor } from './ai-execution-result.processor';

const EXECUTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORRELATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROFILE_ID = 'profile-1';
const INFLUENCER_ID = 'inf-1';

function baseCompletedResult(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    executionId: EXECUTION_ID,
    correlationId: CORRELATION_ID,
    type: 'IBP_GENERATION',
    status: 'COMPLETED',
    startedAt: '2026-11-01T16:26:04.000Z',
    finishedAt: '2026-11-01T16:26:21.000Z',
    durationMs: 16862,
    metadata: {
      provider: 'ollama',
      model: 'llama3.2:3b',
      llmCallCount: 1,
      promptBusinessHash: 'b1e68ccf4e9b99eb',
    },
    output: {
      targetSectors: ['tech'],
      excludedSectors: ['gambling'],
      brandSize: ['mid_market'],
      markets: ['Spain', 'LATAM'],
      collaborationTypes: ['product review'],
      summary: 'Mid-market tech brands for refurbishment content',
      alertSignals: ['scam claims'],
      desirableCriteria: ['authentic demos'],
    },
    ...overrides,
  };
}

function processingProfile(
  overrides: Partial<{
    id: string;
    influencerId: string;
    status: IbpStatus;
    metadata: Record<string, unknown> | null;
  }> = {},
) {
  return {
    id: PROFILE_ID,
    influencerId: INFLUENCER_ID,
    status: IbpStatus.PROCESSING,
    metadata: {
      aiExecution: {
        executionId: EXECUTION_ID,
        correlationId: CORRELATION_ID,
        transport: 'bullmq',
        requestedAt: '2026-11-01T16:26:04.000Z',
      },
    },
    ...overrides,
  };
}

describe('AiExecutionResultProcessor', () => {
  function createProcessor(prisma: {
    idealBrandProfile: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  }) {
    return new AiExecutionResultProcessor(prisma as never);
  }

  it('ignores jobs that are not ai.result', async () => {
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: 'x',
      name: 'other',
      data: baseCompletedResult(),
    } as never);

    expect(prisma.idealBrandProfile.findFirst).not.toHaveBeenCalled();
    expect(prisma.idealBrandProfile.update).not.toHaveBeenCalled();
  });

  it('persists DRAFT IBP from a valid COMPLETED result matching executionId', async () => {
    const profile = processingProfile();
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const processor = createProcessor(prisma);
    const result = baseCompletedResult();

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: result,
    } as never);

    expect(prisma.idealBrandProfile.findFirst).toHaveBeenCalledWith({
      where: {
        status: IbpStatus.PROCESSING,
        metadata: {
          path: ['aiExecution', 'executionId'],
          equals: EXECUTION_ID,
        },
      },
    });

    expect(prisma.idealBrandProfile.update).toHaveBeenCalledTimes(1);
    const updateArg = prisma.idealBrandProfile.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: PROFILE_ID });
    expect(updateArg.data.status).toBe(IbpStatus.DRAFT);
    expect(updateArg.data.targetSectors).toEqual(['tech']);
    expect(updateArg.data.excludedSectors).toEqual(['gambling']);
    expect(updateArg.data.brandSize).toEqual(['mid_market']);
    expect(updateArg.data.markets).toEqual(['Spain', 'LATAM']);
    expect(updateArg.data.collaborationTypes).toEqual(['product review']);
    expect(updateArg.data.summary).toBe(
      'Mid-market tech brands for refurbishment content',
    );
    expect(updateArg.data.alertSignals).toEqual(['scam claims']);
    expect(updateArg.data.desirableCriteria).toEqual(['authentic demos']);
    expect(updateArg.data.metadata).toEqual({
      provider: 'ollama',
      model: 'llama3.2:3b',
      lastGeneratedAt: result.finishedAt,
      promptVersion: '2',
      promptInstructionsHash: 'b1e68ccf4e9b99eb',
      llmCallCount: 1,
      aiExecution: {
        executionId: EXECUTION_ID,
        correlationId: CORRELATION_ID,
        status: 'COMPLETED',
        finishedAt: result.finishedAt,
        durationMs: 16862,
      },
    });
  });

  it('looks up PROCESSING profile by executionId (influencer comes from that row)', async () => {
    const profile = processingProfile({ influencerId: 'solusat-id' });
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: baseCompletedResult(),
    } as never);

    expect(prisma.idealBrandProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          metadata: {
            path: ['aiExecution', 'executionId'],
            equals: EXECUTION_ID,
          },
        }),
      }),
    );
    expect(prisma.idealBrandProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PROFILE_ID } }),
    );
  });

  it('skips invalid AiExecutionResult contracts without persisting', async () => {
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: 'bad',
      name: AI_EXECUTION_JOBS.RESULT,
      data: { not: 'a-valid-result' },
    } as never);

    expect(prisma.idealBrandProfile.findFirst).not.toHaveBeenCalled();
    expect(prisma.idealBrandProfile.update).not.toHaveBeenCalled();
  });

  it('ignores BRAND_DISCOVERY results after successful parse', async () => {
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: 'brand-result',
      name: AI_EXECUTION_JOBS.RESULT,
      data: {
        contractVersion: AI_CONTRACT_VERSION,
        executionId: EXECUTION_ID,
        correlationId: CORRELATION_ID,
        type: 'BRAND_DISCOVERY',
        status: 'COMPLETED',
        startedAt: '2026-11-01T16:26:04.000Z',
        finishedAt: '2026-11-01T16:26:21.000Z',
        durationMs: 100,
        metadata: { provider: 'ollama', model: 'llama3.2:3b' },
        output: {
          operation: 'SCORE_CANDIDATES',
          brands: [
            {
              name: 'Acme',
              website: 'https://acme.example',
              sector: 'tech',
              market: 'Spain',
              brandSize: 'smb',
              score: 80,
              fitReason: 'fit',
              evidenceUrls: ['https://acme.example'],
            },
          ],
        },
      },
    } as never);

    expect(prisma.idealBrandProfile.findFirst).not.toHaveBeenCalled();
    expect(prisma.idealBrandProfile.update).not.toHaveBeenCalled();
  });

  it('skips when no PROCESSING IBP exists for executionId', async () => {
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: baseCompletedResult(),
    } as never);

    expect(prisma.idealBrandProfile.update).not.toHaveBeenCalled();
  });

  it('skips duplicate/late result when IBP is already DRAFT (not PROCESSING)', async () => {
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: baseCompletedResult(),
    } as never);

    expect(prisma.idealBrandProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: IbpStatus.PROCESSING }),
      }),
    );
    expect(prisma.idealBrandProfile.update).not.toHaveBeenCalled();
  });

  it('marks IBP FAILED when worker result status is FAILED', async () => {
    const profile = processingProfile();
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const processor = createProcessor(prisma);
    const finishedAt = '2026-11-01T16:26:21.000Z';

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: baseCompletedResult({
        status: 'FAILED',
        output: undefined,
        error: {
          code: 'AI_PROVIDER_ERROR',
          message: 'Ollama unavailable',
          retryable: true,
          occurredAt: finishedAt,
        },
      }),
    } as never);

    expect(prisma.idealBrandProfile.update).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      data: {
        status: IbpStatus.FAILED,
        metadata: expect.objectContaining({
          aiExecution: {
            executionId: EXECUTION_ID,
            correlationId: CORRELATION_ID,
            status: 'FAILED',
            errorCode: 'AI_PROVIDER_ERROR',
            errorMessage: 'Ollama unavailable',
            finishedAt,
          },
        }),
      },
    });
  });

  it('FAILED path preserves prior metadata object and replaces aiExecution', async () => {
    const profile = processingProfile({
      metadata: {
        priorKey: 'keep-me',
        aiExecution: { executionId: EXECUTION_ID, transport: 'bullmq' },
      },
    });
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: baseCompletedResult({
        status: 'FAILED',
        output: undefined,
        error: {
          code: 'AI_INTERNAL_ERROR',
          message: 'agent crashed',
          retryable: false,
          occurredAt: '2026-11-01T16:26:21.000Z',
        },
      }),
    } as never);

    const meta = prisma.idealBrandProfile.update.mock.calls[0][0].data.metadata;
    expect(meta.priorKey).toBe('keep-me');
    expect(meta.aiExecution.status).toBe('FAILED');
    expect(meta.aiExecution.errorCode).toBe('AI_INTERNAL_ERROR');
  });

  it('FAILED path starts clean metadata when profile.metadata is null', async () => {
    const profile = processingProfile({ metadata: null });
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: baseCompletedResult({
        status: 'FAILED',
        output: undefined,
        error: {
          code: 'AI_INVALID_OUTPUT',
          message: 'bad json',
          retryable: false,
          occurredAt: '2026-11-01T16:26:21.000Z',
        },
      }),
    } as never);

    expect(prisma.idealBrandProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: {
            aiExecution: expect.objectContaining({
              status: 'FAILED',
              errorCode: 'AI_INVALID_OUTPUT',
            }),
          },
        }),
      }),
    );
  });

  it('persists COMPLETED status and fields in a single Prisma update (no multi-step write)', async () => {
    const profile = processingProfile();
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: baseCompletedResult(),
    } as never);

    expect(prisma.idealBrandProfile.update).toHaveBeenCalledTimes(1);
    const data = prisma.idealBrandProfile.update.mock.calls[0][0].data;
    expect(data.status).toBe(IbpStatus.DRAFT);
    expect(data.summary).toBeDefined();
    expect(data.metadata.aiExecution.status).toBe('COMPLETED');
  });

  it('marks IBP FAILED when COMPLETED has no output (incomplete payload)', async () => {
    const profile = processingProfile();
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: baseCompletedResult({
        status: 'COMPLETED',
        output: undefined,
      }),
    } as never);

    expect(prisma.idealBrandProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: IbpStatus.FAILED }),
      }),
    );
  });

  it('propagates Prisma update errors on successful COMPLETED path', async () => {
    const profile = processingProfile();
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockRejectedValue(new Error('db write failed')),
      },
    };
    const processor = createProcessor(prisma);

    await expect(
      processor.process({
        id: `result-${EXECUTION_ID}`,
        name: AI_EXECUTION_JOBS.RESULT,
        data: baseCompletedResult(),
      } as never),
    ).rejects.toThrow('db write failed');
  });

  it('propagates Prisma update errors on FAILED path', async () => {
    const profile = processingProfile();
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockRejectedValue(new Error('status update failed')),
      },
    };
    const processor = createProcessor(prisma);

    await expect(
      processor.process({
        id: `result-${EXECUTION_ID}`,
        name: AI_EXECUTION_JOBS.RESULT,
        data: baseCompletedResult({
          status: 'FAILED',
          output: undefined,
          error: {
            code: 'AI_INTERNAL_ERROR',
            message: 'boom',
            retryable: false,
            occurredAt: '2026-11-01T16:26:21.000Z',
          },
        }),
      } as never),
    ).rejects.toThrow('status update failed');
  });

  it('rejects incomplete IBP output structure at contract parse (no DB write)', async () => {
    const prisma = {
      idealBrandProfile: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const processor = createProcessor(prisma);

    await processor.process({
      id: `result-${EXECUTION_ID}`,
      name: AI_EXECUTION_JOBS.RESULT,
      data: baseCompletedResult({
        output: {
          targetSectors: ['tech'],
          // missing required arrays / summary
        },
      }),
    } as never);

    expect(prisma.idealBrandProfile.findFirst).not.toHaveBeenCalled();
    expect(prisma.idealBrandProfile.update).not.toHaveBeenCalled();
  });
});
