import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';

jest.mock('../instagram-research.service', () => ({
  InstagramResearchService: class InstagramResearchService {},
}));

import { INSTAGRAM_RESEARCH_JOBS } from '../../bullmq/job-types';
import { InstagramResearchService } from '../instagram-research.service';
import { InstagramResearchProcessor } from './instagram-research.processor';

describe('InstagramResearchProcessor', () => {
  let processor: InstagramResearchProcessor;

  const instagramResearchService = {
    executeRun: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramResearchProcessor,
        {
          provide: InstagramResearchService,
          useValue: instagramResearchService,
        },
      ],
    }).compile();

    processor = module.get(InstagramResearchProcessor);
    jest.clearAllMocks();
  });

  it('delegates research-by-username to executeRun', async () => {
    await processor.process({
      id: '1',
      name: INSTAGRAM_RESEARCH_JOBS.RESEARCH_BY_USERNAME,
      data: { runId: 'run-1' },
    } as Job);

    expect(instagramResearchService.executeRun).toHaveBeenCalledWith('run-1');
  });

  it('delegates research-by-influencer to executeRun', async () => {
    await processor.process({
      id: '2',
      name: INSTAGRAM_RESEARCH_JOBS.RESEARCH_BY_INFLUENCER,
      data: { runId: 'run-2' },
    } as Job);

    expect(instagramResearchService.executeRun).toHaveBeenCalledWith('run-2');
  });

  it('ignores unknown job names', async () => {
    await processor.process({
      id: '3',
      name: 'other-job',
      data: { runId: 'run-3' },
    } as Job);

    expect(instagramResearchService.executeRun).not.toHaveBeenCalled();
  });
});
