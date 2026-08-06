import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class LeadSearchOptionsDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'IDs de opciones del provider manual. No requerido para ai+brightdata.',
    example: ['gd_me5ppxjr2ge6icjuh0'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  optionIds?: string[];
}

export class SearchLeadsDto {
  @ApiProperty({
    type: [String],
    description: 'IDs de BrandCandidate en estado APPROVED',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  brandCandidateIds!: string[];

  @ApiPropertyOptional({
    description:
      'Provider de leads. Default: ai+brightdata (autónomo). Manual: brightdata.',
    example: 'ai+brightdata',
  })
  @IsOptional()
  @IsString()
  providerId?: string;

  @ApiPropertyOptional({ type: LeadSearchOptionsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LeadSearchOptionsDto)
  options?: LeadSearchOptionsDto;

  @ApiPropertyOptional({
    description: 'Máximo de contactos por marca (1–20)',
    minimum: 1,
    maximum: 20,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
