import type { PaginationMeta } from '../dto/pagination-meta.interface';

export interface PrismaPaginationParams {
  skip: number;
  take: number;
}

export function buildPrismaPagination(
  page: number,
  limit: number,
): PrismaPaginationParams {
  return {
    skip: (page - 1) * limit,
    take: limit,
  };
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
