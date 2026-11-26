import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { CSV_MAX_ROWS } from '../prospects-csv.service';
import {
  APPROVAL_SOURCE_TYPES,
  type ApprovalSourceType,
} from '../prospects-ingestion.service';
import { CONFLICT_ACTIONS, type ConflictAction } from '../prospects.mapper';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const toBool = ({ value }: { value: unknown }) =>
  value === undefined || value === ''
    ? undefined
    : value === true || value === 'true';

export const PROSPECT_SOURCES = [
  'LEAD',
  'BRAND_CONTACT',
  'AGENCY_CONTACT',
  'CSV',
  'MANUAL',
  'SALESHANDY',
] as const;
export const PROSPECT_STATUS_FILTERS = ['active', 'archived', 'all'] as const;
export const PROSPECT_SORT_KEYS = ['createdAt', 'email', 'company'] as const;

export class QueryProspectsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() influencerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() brandCandidateId?: string;

  @ApiPropertyOptional({ description: 'Email, name, company or domain' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: PROSPECT_SOURCES })
  @IsOptional()
  @IsIn(PROSPECT_SOURCES)
  source?: (typeof PROSPECT_SOURCES)[number];
  @ApiPropertyOptional({ enum: ['PERSON', 'MAILBOX'] })
  @IsOptional()
  @IsIn(['PERSON', 'MAILBOX'])
  contactKind?: 'PERSON' | 'MAILBOX';
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isGeneric?: boolean;

  @ApiPropertyOptional({ enum: PROSPECT_STATUS_FILTERS, default: 'active' })
  @IsOptional()
  @IsIn(PROSPECT_STATUS_FILTERS)
  status?: (typeof PROSPECT_STATUS_FILTERS)[number] = 'active';

  @ApiPropertyOptional({ enum: PROSPECT_SORT_KEYS, default: 'createdAt' })
  @IsOptional()
  @IsIn(PROSPECT_SORT_KEYS)
  sortBy?: (typeof PROSPECT_SORT_KEYS)[number] = 'createdAt';
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}

export class ApprovalItemDto {
  @ApiProperty({ enum: APPROVAL_SOURCE_TYPES })
  @IsIn(APPROVAL_SOURCE_TYPES)
  type!: ApprovalSourceType;
  @ApiProperty() @IsUUID() id!: string;
  @ApiPropertyOptional({ description: 'Required for AGENCY_CONTACT' })
  @IsOptional()
  @IsUUID()
  influencerId?: string;
}

export class ApproveProspectsDto {
  @ApiProperty({ type: [ApprovalItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ApprovalItemDto)
  items!: ApprovalItemDto[];
}

class ProspectEditableDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) firstName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) lastName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) jobTitle?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) company?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  companyDomain?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) website?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  linkedInUrl?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) country?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  phoneNumber?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  mailboxLabel?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];
}

export class CustomFieldValueDto {
  @ApiProperty() @IsUUID() fieldId!: string;
  @ApiProperty({ description: 'Empty string clears it' })
  @IsString()
  @MaxLength(10_000)
  value!: string;
}

export class CreateProspectDto extends ProspectEditableDto {
  @ApiProperty() @IsUUID() influencerId!: string;
  @ApiProperty() @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
}

export class UpdateProspectDto extends ProspectEditableDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';

  @ApiPropertyOptional({ type: [CustomFieldValueDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CustomFieldValueDto)
  customFields?: CustomFieldValueDto[];
}

export class ImportProspectsCsvDto {
  @ApiProperty() @IsUUID() influencerId!: string;

  @ApiProperty({ enum: CONFLICT_ACTIONS, default: 'addMissingFields' })
  @IsIn(CONFLICT_ACTIONS)
  conflictAction: ConflictAction = 'addMissingFields';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @ApiProperty({
    description: `Rows keyed by CustomField key (max ${CSV_MAX_ROWS}); "email" is required`,
    type: 'array',
    items: { type: 'object' },
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CSV_MAX_ROWS)
  @IsObject({ each: true })
  // Without an explicit element type, implicit conversion turns each row into [].
  @Type(() => Object)
  rows!: Array<Record<string, string>>;
}

export class ApprovedIdsQueryDto {
  @ApiProperty() @IsUUID() influencerId!: string;
}
