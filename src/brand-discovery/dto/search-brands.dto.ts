import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class SearchBrandsDto {
  @ApiProperty({
    type: [String],
    description: 'IDs de influencers con IBP ACTIVE',
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  influencerIds!: string[];

  @ApiPropertyOptional({
    description: 'Máximo de marcas a buscar por influencer (1–20)',
    minimum: 1,
    maximum: 20,
    default: 20,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
