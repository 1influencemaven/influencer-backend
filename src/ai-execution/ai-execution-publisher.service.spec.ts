import { createHash } from 'node:crypto';

import {
  AI_CONTRACT_VERSION,
  parseAiExecutionRequest,
  type IbpCriteriaSnapshot,
} from '@influence-maven/ai-contracts';

import {
  AiExecutionPublisherService,
  BRAND_DISCOVERY_DEFAULT_MAX_QUERIES,
} from './ai-execution-publisher.service';
import { AI_EXECUTION_JOBS } from './ai-execution.queues';

describe('AiExecutionPublisherService', () => {
  const influencer = { id: 'inf-1', name: 'Ada', niche: 'fitness' };

  const ibpSnapshot: IbpCriteriaSnapshot = {
    targetSectors: ['wellness', 'sportswear'],
    excludedSectors: ['gambling'],
    brandSize: ['smb'],
    markets: ['Spain'],
    collaborationTypes: ['brand ambassador'],
    summary: 'Marcas wellness auténticas',
    alertSignals: ['miracle claims'],
    desirableCriteria: ['sustainability'],
  };

  const brandBase = {
    runId: 'run-bd-1',
    userId: 'user-1',
    influencerId: 'inf-1',
    influencerName: 'Ada',
    niche: 'fitness' as string | null,
    subNiche: 'home workouts' as string | null,
    country: 'Spain' as string | null,
    language: 'es' as string | null,
    followers: 120_000 as number | null,
    engagement: 3.5 as number | null,
    ibp: ibpSnapshot,
    actorRole: 'USER' as const,
    locale: 'es' as const,
    promptInstructions: 'Prefiere evidencia en sitio oficial',
  };

  function buildService(add: jest.Mock, getImpl?: (key: string) => unknown) {
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

    const [, payload, opts] = add.mock.calls[0];
    expect(payload.idempotencyKey).toContain(':');
    expect(opts.jobId).toBe(ids.executionId);
    expect(String(opts.jobId)).not.toMatch(/:/);
  });

  describe('Brand Discovery publish', () => {
    it('publishes PLAN_SEARCH with Settings instructions, influencer profile and run context', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job-plan' });
      const service = buildService(add);

      const ids = await service.publishBrandDiscoveryPlan({
        ...brandBase,
        maxQueries: 4,
      });

      expect(add).toHaveBeenCalledTimes(1);
      const [jobName, payload, opts] = add.mock.calls[0];
      expect(jobName).toBe(AI_EXECUTION_JOBS.EXECUTE);
      expect(opts.jobId).toBe(ids.executionId);
      expect(opts.jobId).not.toContain(':');
      expect(opts.removeOnComplete).toBe(1000);
      expect(opts.removeOnFail).toBe(5000);

      const parsed = parseAiExecutionRequest(payload);
      expect(parsed.type).toBe('BRAND_DISCOVERY');
      expect(parsed.executionId).toBe(ids.executionId);
      expect(parsed.correlationId).toBe(ids.correlationId);
      expect(parsed.idempotencyKey).toBe(
        `brand-plan:${brandBase.runId}:${ids.executionId}`,
      );
      expect(parsed.instructions.business).toBe(brandBase.promptInstructions);
      expect(parsed.instructions.businessHash).toBe(
        createHash('sha256')
          .update(brandBase.promptInstructions)
          .digest('hex')
          .slice(0, 16),
      );
      expect(parsed.context).toEqual(
        expect.objectContaining({
          userId: 'user-1',
          influencerId: 'inf-1',
          resourceId: 'run-bd-1',
          resourceType: 'BRAND_DISCOVERY_RUN',
          actorRole: 'USER',
          locale: 'es',
        }),
      );
      expect(parsed.configuration).toEqual({
        provider: 'ollama',
        model: 'llama3.2:3b',
      });

      if (parsed.type === 'BRAND_DISCOVERY') {
        expect(parsed.input.operation).toBe('PLAN_SEARCH');
        if (parsed.input.operation === 'PLAN_SEARCH') {
          expect(parsed.input.maxQueries).toBe(4);
          expect(parsed.input.influencerName).toBe('Ada');
          expect(parsed.input.niche).toBe('fitness');
          expect(parsed.input.subNiche).toBe('home workouts');
          expect(parsed.input.country).toBe('Spain');
          expect(parsed.input.followers).toBe(120_000);
          expect(parsed.input.ibp).toEqual(ibpSnapshot);
        }
      }
    });

    it('defaults PLAN_SEARCH maxQueries to the agreed cap', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job-plan' });
      const service = buildService(add);

      await service.publishBrandDiscoveryPlan(brandBase);

      const parsed = parseAiExecutionRequest(add.mock.calls[0][1]);
      if (
        parsed.type === 'BRAND_DISCOVERY' &&
        parsed.input.operation === 'PLAN_SEARCH'
      ) {
        expect(parsed.input.maxQueries).toBe(
          BRAND_DISCOVERY_DEFAULT_MAX_QUERIES,
        );
      }
    });

    it('publishes SCORE_CANDIDATES with Settings instructions, hits and seeds', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job-score' });
      const service = buildService(add);
      const promptInstructions = 'Prefiere evidencia en sitio oficial';

      const ids = await service.publishBrandDiscoveryScore({
        ...brandBase,
        limit: 10,
        searchHits: [
          {
            title: 'Demo Wellness',
            url: 'https://demo.example',
            content: 'fitness apparel',
          },
        ],
        seedBrands: [
          {
            name: 'Seed Co',
            website: 'https://seed.example',
            sector: 'wellness',
          },
        ],
        promptInstructions,
      });

      const [jobName, payload, opts] = add.mock.calls[0];
      expect(jobName).toBe(AI_EXECUTION_JOBS.EXECUTE);
      expect(opts.jobId).toBe(ids.executionId);

      const parsed = parseAiExecutionRequest(payload);
      expect(parsed.type).toBe('BRAND_DISCOVERY');
      expect(parsed.idempotencyKey).toBe(
        `brand-score:${brandBase.runId}:${ids.executionId}`,
      );
      expect(parsed.instructions.business).toBe(promptInstructions);
      expect(parsed.instructions.businessHash).toBe(
        createHash('sha256')
          .update(promptInstructions)
          .digest('hex')
          .slice(0, 16),
      );
      expect(parsed.context.resourceId).toBe('run-bd-1');
      expect(parsed.context.resourceType).toBe('BRAND_DISCOVERY_RUN');

      if (parsed.type === 'BRAND_DISCOVERY') {
        expect(parsed.input.operation).toBe('SCORE_CANDIDATES');
        if (parsed.input.operation === 'SCORE_CANDIDATES') {
          expect(parsed.input.limit).toBe(10);
          expect(parsed.input.searchHits).toHaveLength(1);
          expect(parsed.input.seedBrands).toEqual([
            {
              name: 'Seed Co',
              website: 'https://seed.example',
              sector: 'wellness',
            },
          ]);
          expect(parsed.input.ibp).toEqual(ibpSnapshot);
        }
      }
    });

    it('omits seedBrands when not provided on SCORE_CANDIDATES', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job-score' });
      const service = buildService(add);

      await service.publishBrandDiscoveryScore({
        ...brandBase,
        limit: 5,
        searchHits: [{ title: 'A', url: 'https://a.example' }],
        promptInstructions: 'score',
      });

      const parsed = parseAiExecutionRequest(add.mock.calls[0][1]);
      if (
        parsed.type === 'BRAND_DISCOVERY' &&
        parsed.input.operation === 'SCORE_CANDIDATES'
      ) {
        expect(parsed.input.seedBrands).toBeUndefined();
      }
    });

    it('generates independent executionIds for PLAN and SCORE', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job' });
      const service = buildService(add);

      const plan = await service.publishBrandDiscoveryPlan(brandBase);
      const score = await service.publishBrandDiscoveryScore({
        ...brandBase,
        limit: 5,
        searchHits: [{ title: 'A', url: 'https://a.example' }],
        promptInstructions: 'score',
      });

      expect(plan.executionId).not.toBe(score.executionId);
      expect(plan.correlationId).not.toBe(score.correlationId);
      expect(add.mock.calls[0][2].jobId).toBe(plan.executionId);
      expect(add.mock.calls[1][2].jobId).toBe(score.executionId);
    });

    it('propagates Redis failures for Brand Discovery publishes', async () => {
      const add = jest.fn().mockRejectedValue(new Error('ECONNREFUSED Redis'));
      const service = buildService(add);

      await expect(
        service.publishBrandDiscoveryPlan(brandBase),
      ).rejects.toThrow('ECONNREFUSED Redis');

      await expect(
        service.publishBrandDiscoveryScore({
          ...brandBase,
          limit: 5,
          searchHits: [{ title: 'A', url: 'https://a.example' }],
          promptInstructions: 'score',
        }),
      ).rejects.toThrow('ECONNREFUSED Redis');
    });

    it('keeps IBP publish path unchanged alongside Brand methods', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job' });
      const service = buildService(add);

      const ibp = await service.publishIbpGeneration({
        influencer,
        userId: 'user-1',
        promptInstructions: 'Build IBP',
      });
      const plan = await service.publishBrandDiscoveryPlan(brandBase);

      expect(ibp.executionId).not.toBe(plan.executionId);
      expect(parseAiExecutionRequest(add.mock.calls[0][1]).type).toBe(
        'IBP_GENERATION',
      );
      expect(parseAiExecutionRequest(add.mock.calls[1][1]).type).toBe(
        'BRAND_DISCOVERY',
      );
      expect(add.mock.calls[0][1].idempotencyKey).toMatch(/^ibp:/);
      expect(add.mock.calls[1][1].idempotencyKey).toMatch(/^brand-plan:/);
    });
  });

  describe('publishContactResearchFindBrandEmails', () => {
    it('publishes CONTACT_RESEARCH FIND_BRAND_EMAILS', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job' });
      const service = buildService(add);

      const ids = await service.publishContactResearchFindBrandEmails({
        runId: 'run-contact-1',
        userId: 'user-1',
        influencerId: influencer.id,
        brandName: 'Demo Co',
        website: 'https://demo.co',
        domain: 'demo.co',
        niche: 'home',
        maxSerpQueries: 3,
        maxPages: 4,
      });

      expect(ids.executionId).toBeTruthy();
      const parsed = parseAiExecutionRequest(add.mock.calls[0][1]);
      expect(parsed.type).toBe('CONTACT_RESEARCH');
      if (parsed.type === 'CONTACT_RESEARCH') {
        expect(parsed.input.operation).toBe('FIND_BRAND_EMAILS');
        if (parsed.input.operation === 'FIND_BRAND_EMAILS') {
          expect(parsed.input.domain).toBe('demo.co');
          expect(parsed.input.maxSerpQueries).toBe(3);
        }
      }
      expect(add.mock.calls[0][1].idempotencyKey).toMatch(/^contact-emails:/);
      expect(add.mock.calls[0][1].context.resourceType).toBe(
        'CONTACT_RESEARCH_RUN',
      );
    });
  });

  describe('publishContactResearchFindAgencyPeople', () => {
    it('publishes CONTACT_RESEARCH FIND_AGENCY_PEOPLE with ALWAYS policy', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job' });
      const service = buildService(add);

      const ids = await service.publishContactResearchFindAgencyPeople({
        runId: 'run-agency-p1',
        userId: 'user-1',
        influencerId: influencer.id,
        agencyId: 'agency-1',
        agencyName: 'Creator Partners',
        website: 'https://creatorpartners.example',
        domain: 'creatorpartners.example',
        maxSerpQueries: 3,
        maxProfilesToScrape: 4,
        maxAgencyPages: 5,
      });

      expect(ids.executionId).toBeTruthy();
      const parsed = parseAiExecutionRequest(add.mock.calls[0][1]);
      expect(parsed.type).toBe('CONTACT_RESEARCH');
      if (parsed.type === 'CONTACT_RESEARCH') {
        expect(parsed.input.operation).toBe('FIND_AGENCY_PEOPLE');
        if (parsed.input.operation === 'FIND_AGENCY_PEOPLE') {
          expect(parsed.input.peoplePassPolicy).toBe('ALWAYS');
          expect(parsed.input.agencyId).toBe('agency-1');
        }
      }
      expect(add.mock.calls[0][1].idempotencyKey).toMatch(/^agency-people:/);
    });
  });

  describe('publishContactResearchFindAgencyEmails', () => {
    it('publishes CONTACT_RESEARCH FIND_AGENCY_EMAILS', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job' });
      const service = buildService(add);

      const ids = await service.publishContactResearchFindAgencyEmails({
        runId: 'run-agency-1',
        userId: 'user-1',
        influencerId: influencer.id,
        agencyId: 'agency-1',
        agencyName: 'Creator Partners',
        website: 'https://creatorpartners.example',
        domain: 'creatorpartners.example',
        niche: 'home',
        niches: ['home'],
        maxSerpQueries: 3,
        maxPages: 4,
        seedUrls: ['https://creatorpartners.example/contact'],
      });

      expect(ids.executionId).toBeTruthy();
      const parsed = parseAiExecutionRequest(add.mock.calls[0][1]);
      expect(parsed.type).toBe('CONTACT_RESEARCH');
      if (parsed.type === 'CONTACT_RESEARCH') {
        expect(parsed.input.operation).toBe('FIND_AGENCY_EMAILS');
        if (parsed.input.operation === 'FIND_AGENCY_EMAILS') {
          expect(parsed.input.agencyId).toBe('agency-1');
          expect(parsed.input.domain).toBe('creatorpartners.example');
          expect(parsed.input.maxSerpQueries).toBe(3);
          expect(parsed.input.seedUrls).toEqual([
            'https://creatorpartners.example/contact',
          ]);
        }
      }
      expect(add.mock.calls[0][1].idempotencyKey).toMatch(/^agency-emails:/);
      expect(add.mock.calls[0][1].context.resourceType).toBe(
        'CONTACT_RESEARCH_RUN',
      );
    });
  });

  describe('publishContactResearchFindBrandPeople', () => {
    it('publishes CONTACT_RESEARCH FIND_BRAND_PEOPLE', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job' });
      const service = buildService(add);

      const ids = await service.publishContactResearchFindBrandPeople({
        runId: 'run-people-1',
        userId: 'user-1',
        influencerId: influencer.id,
        brandName: 'Demo Co',
        website: 'https://demo.co',
        domain: 'demo.co',
        niche: 'wellness',
        priorityRoles: ['Partnerships'],
        maxSerpQueries: 4,
        maxProfilesToScrape: 5,
        maxBrandPages: 6,
        ocrEnabled: false,
      });

      expect(ids.executionId).toBeTruthy();
      const parsed = parseAiExecutionRequest(add.mock.calls[0][1]);
      expect(parsed.type).toBe('CONTACT_RESEARCH');
      if (parsed.type === 'CONTACT_RESEARCH') {
        expect(parsed.input.operation).toBe('FIND_BRAND_PEOPLE');
        if (parsed.input.operation === 'FIND_BRAND_PEOPLE') {
          expect(parsed.input.domain).toBe('demo.co');
          expect(parsed.input.maxProfilesToScrape).toBe(5);
          expect(parsed.input.ocrEnabled).toBe(false);
          expect(parsed.input.priorityRoles).toEqual(['Partnerships']);
        }
      }
      expect(add.mock.calls[0][1].idempotencyKey).toMatch(/^contact-people:/);
      expect(add.mock.calls[0][1].context.resourceType).toBe(
        'CONTACT_RESEARCH_RUN',
      );
    });
  });
});
