import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';

import { CONTACT_DISCOVERY_JOBS } from '../../bullmq/job-types';
import { QUEUES } from '../../bullmq/queue.constants';
import { LeadDiscoveryStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { AiContactResearchOrchestrator } from '../orchestrator/ai-contact-research.orchestrator';
import { BbcDiscoveryOrchestrator } from '../orchestrator/bbc-discovery.orchestrator';
import type { DiscoverBusinessContactsJobData } from '../interfaces/discover-business-contacts-job.interface';
import { interpretBbcDiscoveryResult } from '../utils/bbc-job-result.util';

/**
 * Consumes `contact-discovery` queue. Does not touch `prospecting` / find-brands.
 *
 * Prefers AI research orchestrator when CONTACT_DISCOVERY_AI_ORCHESTRATOR=true.
 * On AI_PROVIDER_UNAVAILABLE, falls back to allowlist BbcDiscoveryOrchestrator
 * and labels that path as degraded (deterministic), never as full AI research.
 */
@Processor(QUEUES.CONTACT_DISCOVERY)
export class ContactDiscoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(ContactDiscoveryProcessor.name);

  constructor(
    private readonly orchestrator: BbcDiscoveryOrchestrator,
    private readonly aiOrchestrator: AiContactResearchOrchestrator,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job<DiscoverBusinessContactsJobData>): Promise<{
    skipped?: boolean;
    runStatus?: string;
    outcome?: string | null;
    terminalStatusPersisted?: boolean;
    partialContactsMayExist?: boolean;
  }> {
    if (job.name !== CONTACT_DISCOVERY_JOBS.DISCOVER_BUSINESS_CONTACTS) {
      this.logger.warn(
        JSON.stringify({
          event: 'bbc_discovery_unknown_job',
          jobName: job.name,
          jobId: job.id,
        }),
      );
      return { skipped: true };
    }

    const { runId, brandCandidateId, website, domain, maxPages } = job.data;

    if (!runId || !brandCandidateId || !website) {
      throw new UnrecoverableError(
        'Invalid discover-business-contacts payload (missing runId, brandCandidateId, or website)',
      );
    }

    const run = await this.prisma.leadDiscoveryRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true, brandCandidateId: true },
    });

    if (!run) {
      throw new UnrecoverableError(
        `LeadDiscoveryRun ${runId} not found — cannot run BBC discovery`,
      );
    }

    if (
      run.status === LeadDiscoveryStatus.COMPLETED ||
      run.status === LeadDiscoveryStatus.FAILED
    ) {
      this.logger.log(
        JSON.stringify({
          event: 'bbc_discovery_job_skipped_terminal',
          runId,
          status: run.status,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
        }),
      );
      return { skipped: true, runStatus: run.status };
    }

    this.logger.log(
      JSON.stringify({
        event: 'bbc_discovery_job_started',
        runId,
        brandCandidateId,
        jobId: job.id,
        attemptsMade: job.attemptsMade,
      }),
    );

    const brandName =
      (
        await this.prisma.brandCandidate.findUnique({
          where: { id: brandCandidateId },
          select: { name: true },
        })
      )?.name ?? undefined;

    const useAi =
      this.configService.get<boolean>('CONTACT_DISCOVERY_AI_ORCHESTRATOR') !==
      false;

    let result;
    if (useAi) {
      result = await this.aiOrchestrator.execute({
        runId,
        brandCandidateId,
        website,
        domain: domain ?? '',
        brandName,
        ...(maxPages != null ? { maxPages } : {}),
      });
      // Explicit AI outage → deterministic allowlist BBC (degraded, not AI).
      if (
        result.runStatus === 'FAILED' &&
        result.errorMessage?.includes('AI_PROVIDER_UNAVAILABLE')
      ) {
        this.logger.warn(
          JSON.stringify({
            event: 'ai_contact_research_fallback_allowlist',
            runId,
            note: 'degraded_deterministic_not_ai',
          }),
        );
        result = await this.orchestrator.execute({
          runId,
          brandCandidateId,
          website,
          domain: domain ?? '',
          ...(maxPages != null ? { maxPages } : {}),
        });
      }
    } else {
      result = await this.orchestrator.execute({
        runId,
        brandCandidateId,
        website,
        domain: domain ?? '',
        ...(maxPages != null ? { maxPages } : {}),
      });
    }

    const interpreted = interpretBbcDiscoveryResult(result);

    if (interpreted.shouldRetryForTerminalPersist) {
      this.logger.error(
        JSON.stringify({
          event: 'bbc_discovery_terminal_status_not_persisted',
          runId,
          runStatusInMemory: interpreted.runStatus,
          partialContactsMayExist: interpreted.partialContactsMayExist,
          errorMessage: interpreted.errorMessage,
          attemptsMade: job.attemptsMade,
        }),
      );
      // Retry: orchestrator upserts are idempotent; do not treat in-memory FAILED as DB truth.
      throw new Error(
        `BBC_TERMINAL_STATUS_NOT_PERSISTED: ${interpreted.errorMessage ?? 'unknown'}`,
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'bbc_discovery_job_finished',
        runId,
        runStatus: interpreted.runStatus,
        outcome: interpreted.outcome,
        terminalStatusPersisted: true,
        partialContactsMayExist: interpreted.partialContactsMayExist,
        contactsCreated: interpreted.contactsCreated,
        contactsUpdated: interpreted.contactsUpdated,
      }),
    );

    // Job succeeds for BullMQ even when business outcome is FAILED —
    // FAILED was persisted; further retries would be incorrect.
    return {
      runStatus: interpreted.runStatus,
      outcome: interpreted.outcome,
      terminalStatusPersisted: true,
      partialContactsMayExist: interpreted.partialContactsMayExist,
    };
  }
}
