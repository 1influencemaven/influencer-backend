import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateIdealBrandProfileDto {
  @ApiProperty({
    description: 'Sectores objetivo',
    example: ['sportswear', 'wellness'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  targetSectors: string[];

  @ApiProperty({
    description: 'Sectores excluidos',
    example: ['alcohol', 'gambling'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  excludedSectors: string[];

  @ApiProperty({
    description: 'Tamaños de marca objetivo',
    example: ['smb', 'mid_market'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  brandSize: string[];

  @ApiProperty({
    description: 'Mercados geográficos',
    example: ['Spain', 'LATAM'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  markets: string[];

  @ApiProperty({
    description: 'Tipos de colaboración',
    example: ['product launch', 'brand ambassador'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  collaborationTypes: string[];

  @ApiProperty({
    description: 'Resumen del perfil ideal',
    example:
      'Marcas de lifestyle saludable en España con presupuesto de influencer marketing.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  summary: string;

  @ApiProperty({
    description: 'Señales de alerta',
    example: ['body-shaming controversies'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  alertSignals: string[];

  @ApiProperty({
    description: 'Criterios deseables',
    example: ['sustainability', 'authentic messaging'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  desirableCriteria: string[];
}

export class GenerateIbpResponseDto {
  @ApiProperty({ example: 'IBP generation job enqueued' })
  message: string;

  @ApiProperty({ example: 'clx123abc456' })
  influencerId: string;

  @ApiProperty({ example: 'PROCESSING', enum: ['PROCESSING'] })
  status: string;
}
