import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PROSPECTING_JOBS } from '../../bullmq/job-types';
import { QUEUES } from '../../bullmq/queue.constants';
import { BrandDiscoveryService } from '../brand-discovery.service';
import type { FindBrandsJobData } from '../interfaces/find-brands-job.interface';

@Processor(QUEUES.PROSPECTING)
export class FindBrandsProcessor extends WorkerHost {
  private readonly logger = new Logger(FindBrandsProcessor.name);

  constructor(private readonly brandDiscoveryService: BrandDiscoveryService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== PROSPECTING_JOBS.FIND_BRANDS) {
      return;
    }

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
  }
}
