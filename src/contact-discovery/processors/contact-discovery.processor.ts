import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';

import { CONTACT_DISCOVERY_JOBS } from '../../bullmq/job-types';
import { QUEUES } from '../../bullmq/queue.constants';
import { LeadDiscoveryStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeContactResearchSeedUrls } from '../../lead-discovery/utils/contact-research-seed-urls.util';
import { CONTACT_DISCOVERY_LOCK_DURATION_MS } from '../contact-discovery-worker.options';
import { ContactEmailMastraOrchestrator } from '../orchestrator/contact-email-mastra.orchestrator';
import type { DiscoverBusinessContactsJobData } from '../interfaces/discover-business-contacts-job.interface';
import { interpretBbcDiscoveryResult } from '../utils/bbc-job-result.util';

/**
 * Consumes `contact-discovery` queue. Does not touch `prospecting` / find-brands.
 *
 * Worker lock (2C.4.6.1): lockDuration covers worst-case 2A+2B+2C waits
 * including agency emails-pass and people-pass (4140s sequential budget).
 * lockRenewTime / stalledInterval are left at BullMQ defaults so LockManager
 * keeps renewing (lockRenewTime = lockDuration/2). Do not set lockRenewTime=0.
 */
@Processor(QUEUES.CONTACT_DISCOVERY, {
  lockDuration: CONTACT_DISCOVERY_LOCK_DURATION_MS,
})
export class ContactDiscoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(ContactDiscoveryProcessor.name);

  constructor(
    private readonly mastraOrchestrator: ContactEmailMastraOrchestrator,
    private readonly prisma: PrismaService,
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

    const { runId, brandCandidateId, influencerId, website, domain, maxPages } =
      job.data;

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

    const brand = await this.prisma.brandCandidate.findUnique({
      where: { id: brandCandidateId },
      select: {
        name: true,
        evidenceUrls: true,
        influencer: { select: { niche: true } },
      },
    });
    const brandName = brand?.name ?? undefined;
    const niche = brand?.influencer?.niche ?? undefined;
    // RF-02.1: drop malformed / non-http(s); never fail the job on bad evidenceUrls.
    const seedUrls = sanitizeContactResearchSeedUrls(brand?.evidenceUrls);

    const result = await this.mastraOrchestrator.execute({
      runId,
      brandCandidateId,
      influencerId,
      website,
      domain: domain ?? '',
      brandName,
      niche,
      seedUrls,
      ...(maxPages != null ? { maxPages } : {}),
    });

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

    return {
      runStatus: interpreted.runStatus,
      outcome: interpreted.outcome,
      terminalStatusPersisted: true,
      partialContactsMayExist: interpreted.partialContactsMayExist,
    };
  }
}
