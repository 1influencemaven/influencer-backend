import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsInt,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { InstagramResearchEvidenceDto } from './instagram-research-evidence.dto';
import { QuarterAssignmentDto } from './quarter-assignment.dto';

export class CreateInfluencerDto {
  @ApiProperty({
    description: 'Nombre del talento / influencer',
    example: 'Laura Martínez',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    description:
      'Handle o URL de Instagram (obligatorio). Se normaliza para deduplicación.',
    example: '@laurafit_es',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  instagram!: string;

  @ApiPropertyOptional({
    description: 'Handle o URL de TikTok',
    example: '@laurafit',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tiktok?: string;

  @ApiPropertyOptional({
    description: 'Handle o URL de YouTube',
    example: '@laurafit',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  youtube?: string;

  @ApiProperty({
    description:
      'Países donde se encuentra actualmente el talento (residencia / ubicación habitual declarada). ISO 3166-1 alpha-2. Al menos uno obligatorio en alta; no es nacionalidad ni país de audiencia. Alimenta las lentes SERP local_home en Brand Discovery.',
    example: ['CO', 'US'],
    type: [String],
    minItems: 1,
  })
  @Transform(({ value }: { value: unknown }) => {
    if (!Array.isArray(value)) {
      return value;
    }
    return value.map((item) =>
      typeof item === 'string' ? item.trim().toUpperCase() : item,
    );
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @IsISO31661Alpha2({ each: true })
  countries!: string[];

  @ApiPropertyOptional({
    description: 'Código de idioma ISO 639-1',
    example: 'es',
    maxLength: 2,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  language?: string;

  @ApiPropertyOptional({
    description: 'Nicho principal (legacy; preferir `niches`)',
    example: 'Fitness',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  niche?: string;

  @ApiPropertyOptional({
    description: 'Subnicho (legacy)',
    example: 'Nutrición deportiva',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subNiche?: string;

  @ApiPropertyOptional({
    description: 'Nichos del talento (Talent Manager)',
    example: ['Fitness', 'Lifestyle'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  niches?: string[];

  @ApiPropertyOptional({
    description: 'Número de seguidores',
    example: 180000,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  followers?: number;

  @ApiPropertyOptional({
    description: 'Tasa de engagement (%)',
    example: 4.5,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  engagement?: number;

  @ApiPropertyOptional({
    description: 'Email de contacto legacy (no confundir con outgoingEmail)',
    example: 'laura@example.com',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    description: 'Email de salida para outreach (Talent Manager)',
    example: 'outreach@agency.com',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  outgoingEmail?: string;

  @ApiPropertyOptional({
    description: 'URL del media kit',
    example: 'https://example.com/mediakit.pdf',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  mediaKitUrl?: string;

  @ApiProperty({
    description:
      'Usuario manager (User.id existente). Obligatorio al crear. No crea usuarios.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  managerId!: string;

  @ApiPropertyOptional({
    description:
      'Asignaciones de trimestre (varios años/trimestres; sin duplicados year+quarter)',
    type: [QuarterAssignmentDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => QuarterAssignmentDto)
  @ArrayUnique(
    (item: QuarterAssignmentDto) => `${item.year}:${item.quarter}`,
    { message: 'quarters must not contain duplicate year+quarter pairs' },
  )
  quarters?: QuarterAssignmentDto[];

  @ApiPropertyOptional({
    description:
      'Evidencia de Instagram Research (username lookup). Solo se persiste al confirmar el alta. No convierte hashtags en nichos. followers/email del paquete se aplican como EXTERNAL si no vienen en el body.',
    type: InstagramResearchEvidenceDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InstagramResearchEvidenceDto)
  instagramResearch?: InstagramResearchEvidenceDto;
}
