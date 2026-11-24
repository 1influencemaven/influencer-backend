import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { EMAIL_ACCOUNT_STATUSES, type EmailAccountStatus } from '../email-accounts.mapper';

export const EMAIL_ACCOUNT_SORT_KEYS = [
  'createdAt',
  'healthScore',
  'remainingQuota',
  'client',
] as const;
export type EmailAccountSortKey = (typeof EMAIL_ACCOUNT_SORT_KEYS)[number];

/** Accepts `a,b` or repeated `?x=a&x=b`. */
const toList = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const list = raw.map((v) => String(v).trim()).filter(Boolean);
  return list.length ? list : undefined;
};

export class QueryEmailAccountsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({ description: 'Email, first or last name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: EMAIL_ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(EMAIL_ACCOUNT_STATUSES)
  status?: EmailAccountStatus;

  @ApiPropertyOptional({ description: 'Comma-separated providers', example: 'zoho,godaddy' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  providers?: string[];

  @ApiPropertyOptional({ description: 'Comma-separated Saleshandy sequence ids' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  sequenceIds?: string[];

  @ApiPropertyOptional({ description: 'Comma-separated Saleshandy client ids' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  clientIds?: string[];

  @ApiPropertyOptional({ enum: EMAIL_ACCOUNT_SORT_KEYS, default: 'createdAt' })
  @IsOptional()
  @IsIn(EMAIL_ACCOUNT_SORT_KEYS)
  sortBy?: EmailAccountSortKey = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
