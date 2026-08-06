import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PROSPECTING_JOBS } from '../../bullmq/job-types';
import { QUEUES } from '../../bullmq/queue.constants';
import type { FindLeadsJobData } from '../../lead-discovery/interfaces/find-leads-job.interface';
import { LeadDiscoveryService } from '../../lead-discovery/lead-discovery.service';
import { BrandDiscoveryService } from '../brand-discovery.service';
import type { FindBrandsJobData } from '../interfaces/find-brands-job.interface';

@Processor(QUEUES.PROSPECTING)
export class FindBrandsProcessor extends WorkerHost {
  private readonly logger = new Logger(FindBrandsProcessor.name);

  constructor(
    private readonly brandDiscoveryService: BrandDiscoveryService,
    private readonly leadDiscoveryService: LeadDiscoveryService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === PROSPECTING_JOBS.FIND_BRANDS) {
      const { runId, influencerId, promptInstructions } =
        job.data as FindBrandsJobData;

      this.logger.log(
        `Processing find-brands for influencer ${influencerId} (run ${runId})`,
      );

      await this.brandDiscoveryService.executeDiscovery(
        runId,
        influencerId,
        promptInstructions,
      );

      this.logger.log(
        `Completed find-brands for influencer ${influencerId} (run ${runId})`,
      );
      return;
    }

    if (job.name === PROSPECTING_JOBS.FIND_LEADS) {
      const { runId, brandCandidateId, promptInstructions } =
        job.data as FindLeadsJobData;

      this.logger.log(
        `Processing find-leads for brand ${brandCandidateId} (run ${runId})`,
      );

      await this.leadDiscoveryService.executeDiscovery(
        runId,
        promptInstructions,
      );

      this.logger.log(
        `Completed find-leads for brand ${brandCandidateId} (run ${runId})`,
      );
    }
  }
}
