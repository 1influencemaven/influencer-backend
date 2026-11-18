import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  IbpStatus,
  InfluencerQuarter,
} from '../../generated/prisma/enums';

export enum InfluencerSortBy {
  NAME = 'name',
  FOLLOWERS = 'followers',
  ENGAGEMENT = 'engagement',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class QueryInfluencersDto {
  @ApiPropertyOptional({
    description: 'Número de página',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Elementos por página',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Búsqueda en nombre, Instagram (raw/normalizado), redes y email',
    example: 'laura',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtro por país (ISO 3166-1 alpha-2)',
    example: 'ES',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({
    description: 'Filtro por idioma (ISO 639-1)',
    example: 'es',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  language?: string;

  @ApiPropertyOptional({
    description: 'Filtro por nicho legacy (string exacto case-insensitive)',
    example: 'Fitness',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  niche?: string;

  @ApiPropertyOptional({
    description: 'Filtro: el array niches contiene este valor',
    example: 'Fitness',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  niches?: string;

  @ApiPropertyOptional({
    description: 'Filtro por subnicho',
    example: 'Nutrición deportiva',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subNiche?: string;

  @ApiPropertyOptional({
    description: 'Filtro por manager (User.id)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({
    description: 'Filtro por año de asignación de trimestre',
    example: 2026,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({
    description: 'Filtro por trimestre (requiere coherencia con year si ambos)',
    enum: InfluencerQuarter,
    example: InfluencerQuarter.Q1,
  })
  @IsOptional()
  @IsEnum(InfluencerQuarter)
  quarter?: InfluencerQuarter;

  @ApiPropertyOptional({
    description: 'Filtro por estado del perfil ideal (IBP)',
    enum: IbpStatus,
    example: IbpStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(IbpStatus)
  ibpStatus?: IbpStatus;

  @ApiPropertyOptional({
    description: 'Campo de ordenamiento',
    enum: InfluencerSortBy,
    default: InfluencerSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(InfluencerSortBy)
  sortBy?: InfluencerSortBy = InfluencerSortBy.CREATED_AT;

  @ApiPropertyOptional({
    description: 'Dirección de ordenamiento',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;
}
