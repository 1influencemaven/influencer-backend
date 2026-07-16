import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IbpStatus } from '../../generated/prisma/enums';
import {
  InfluencerSortBy,
  QueryInfluencersDto,
  SortOrder,
} from './query-influencers.dto';

describe('QueryInfluencersDto', () => {
  it('should apply default pagination and sorting values', async () => {
    const dto = plainToInstance(QueryInfluencersDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.sortBy).toBe(InfluencerSortBy.CREATED_AT);
    expect(dto.sortOrder).toBe(SortOrder.DESC);
  });

  it('should pass validation with filters', async () => {
    const dto = plainToInstance(QueryInfluencersDto, {
      page: 2,
      limit: 50,
      search: 'laura',
      country: 'ES',
      language: 'es',
      niche: 'Fitness',
      subNiche: 'Nutrición',
      ibpStatus: IbpStatus.DRAFT,
      sortBy: InfluencerSortBy.FOLLOWERS,
      sortOrder: SortOrder.ASC,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should fail when page is less than 1', async () => {
    const dto = plainToInstance(QueryInfluencersDto, { page: 0 });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'page')).toBe(true);
  });

  it('should fail when limit exceeds maximum', async () => {
    const dto = plainToInstance(QueryInfluencersDto, { limit: 101 });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'limit')).toBe(true);
  });

  it('should fail when sortBy is invalid', async () => {
    const dto = plainToInstance(QueryInfluencersDto, { sortBy: 'invalid' });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sortBy')).toBe(true);
  });
});
