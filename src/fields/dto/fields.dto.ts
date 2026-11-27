import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  CURRENCY_CODES,
  FIELD_TYPES,
  MAX_DROPDOWN_OPTIONS,
  MAX_FIELD_TAGS,
  type FieldTypeValue,
} from '../fields.mapper';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Accepts `a,b` or repeated `?x=a&x=b`. */
const toList = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const list = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
};

export const FIELD_ORIGIN_FILTERS = ['all', 'custom', 'system'] as const;
export const FIELD_STATUS_FILTERS = ['active', 'disabled', 'all'] as const;
export const FIELD_SORT_KEYS = ['label', 'fieldType', 'updatedAt'] as const;

export class QueryFieldsDto {
  @ApiPropertyOptional({ enum: FIELD_ORIGIN_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(FIELD_ORIGIN_FILTERS)
  origin?: (typeof FIELD_ORIGIN_FILTERS)[number] = 'all';

  @ApiPropertyOptional({ enum: FIELD_STATUS_FILTERS, default: 'active' })
  @IsOptional()
  @IsIn(FIELD_STATUS_FILTERS)
  status?: (typeof FIELD_STATUS_FILTERS)[number] = 'active';

  @ApiPropertyOptional({
    description: 'Comma-separated types',
    example: 'text,dropdown',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsIn(FIELD_TYPES, { each: true })
  fieldTypes?: FieldTypeValue[];

  @ApiPropertyOptional({ description: 'Comma-separated tags (any match)' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Label, key or tag' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: FIELD_SORT_KEYS, default: 'label' })
  @IsOptional()
  @IsIn(FIELD_SORT_KEYS)
  sortBy?: (typeof FIELD_SORT_KEYS)[number] = 'label';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'asc';
}

export class FieldMetadataDto {
  @ApiPropertyOptional({
    type: [String],
    description: `Dropdown options (max ${MAX_DROPDOWN_OPTIONS})`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DROPDOWN_OPTIONS)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  options?: string[];

  @ApiPropertyOptional({ enum: CURRENCY_CODES })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  currencyCode?: string;
}

export class CreateFieldDto {
  @ApiProperty({ example: 'Deal Stage', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'label is required' })
  @MaxLength(100)
  label!: string;

  @ApiProperty({ enum: FIELD_TYPES })
  @IsIn(FIELD_TYPES, {
    message: `fieldType must be one of: ${FIELD_TYPES.join(', ')}`,
  })
  fieldType!: FieldTypeValue;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  fallbackText?: string;

  @ApiPropertyOptional({ type: FieldMetadataDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FieldMetadataDto)
  metadata?: FieldMetadataDto;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_FIELD_TAGS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FIELD_TAGS)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];
}

/**
 * HU-FLD-004: only label, fallback text and tags are editable. Omit `tags` to
 * keep them; send the full list (or `[]`) to replace them.
 */
export class UpdateFieldDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Empty string clears it',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  fallbackText?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Full replacement list; omit to keep',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FIELD_TAGS)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];
}

export class UpdateFieldStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}
