import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { INSTAGRAM_RESEARCH_JOBS } from '../../bullmq/job-types';
import { QUEUES } from '../../bullmq/queue.constants';
import type { InstagramResearchJobData } from '../interfaces/instagram-research-job.interface';
import { INSTAGRAM_RESEARCH_LOCK_DURATION_MS } from '../instagram-research-worker.options';
import { InstagramResearchService } from '../instagram-research.service';

@Processor(QUEUES.INSTAGRAM_RESEARCH, {
  lockDuration: INSTAGRAM_RESEARCH_LOCK_DURATION_MS,
})
export class InstagramResearchProcessor extends WorkerHost {
  private readonly logger = new Logger(InstagramResearchProcessor.name);

  constructor(
    private readonly instagramResearchService: InstagramResearchService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const knownJobs: string[] = [
      INSTAGRAM_RESEARCH_JOBS.RESEARCH_BY_USERNAME,
      INSTAGRAM_RESEARCH_JOBS.RESEARCH_BY_INFLUENCER,
    ];

    if (!knownJobs.includes(job.name)) {
      this.logger.warn(
        JSON.stringify({
          event: 'instagram_research_unknown_job',
          jobName: job.name,
          jobId: job.id,
        }),
      );
      return;
    }

    const { runId } = job.data as InstagramResearchJobData;

    this.logger.log(
      JSON.stringify({
        event: 'instagram_research_job_start',
        jobName: job.name,
        jobId: job.id,
        runId,
      }),
    );

    await this.instagramResearchService.executeRun(runId);

    this.logger.log(
      JSON.stringify({
        event: 'instagram_research_job_done',
        jobName: job.name,
        jobId: job.id,
        runId,
      }),
    );
  }
}
