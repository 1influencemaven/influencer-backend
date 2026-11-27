import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const TEMPLATE_STATUS_FILTERS = ['active', 'archived', 'all'] as const;
export const TEMPLATE_SORT_KEYS = ['updatedAt', 'createdAt', 'name'] as const;
const MAX_BODY = 200_000;

export class QueryTemplatesDto {
  @ApiPropertyOptional({ description: 'Talent; omit to list every talent' })
  @IsOptional()
  @IsUUID()
  influencerId?: string;
  @ApiPropertyOptional({ description: 'Name or subject' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
  @ApiPropertyOptional({ enum: TEMPLATE_STATUS_FILTERS, default: 'active' })
  @IsOptional()
  @IsIn(TEMPLATE_STATUS_FILTERS)
  status?: (typeof TEMPLATE_STATUS_FILTERS)[number] = 'active';
  @ApiPropertyOptional({ enum: TEMPLATE_SORT_KEYS, default: 'updatedAt' })
  @IsOptional()
  @IsIn(TEMPLATE_SORT_KEYS)
  sortBy?: (typeof TEMPLATE_SORT_KEYS)[number] = 'updatedAt';
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
  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}

class TemplateContentDto {
  @ApiProperty({ maxLength: 300 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'subject is required' })
  @MaxLength(300)
  subject!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  preHeader?: string;

  @ApiProperty({ description: 'HTML from the editor' })
  @IsString()
  @IsNotEmpty({ message: 'bodyHtml is required' })
  @MaxLength(MAX_BODY)
  bodyHtml!: string;
}

export class CreateTemplateDto extends TemplateContentDto {
  @ApiProperty() @IsUUID() influencerId!: string;
  @ApiProperty({ maxLength: 150 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(150)
  name!: string;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  subject?: string;
  @ApiPropertyOptional({ description: 'Empty string clears it' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  preHeader?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_BODY)
  bodyHtml?: string;
}

export class ValidateTemplateDto extends TemplateContentDto {}

export class PreviewTemplateDto {
  @ApiPropertyOptional({
    description: 'Saved template; or send influencerId + content for a draft',
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() influencerId?: string;
  @ApiPropertyOptional({
    description: 'Without a prospect, prospect variables use fallbacks',
  })
  @IsOptional()
  @IsUUID()
  prospectId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  preHeader?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY)
  bodyHtml?: string;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  highlightMissing?: boolean = true;
}
