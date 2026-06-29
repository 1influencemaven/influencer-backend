import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateInfluencerDto {
  @ApiProperty({
    description: 'Nombre del influencer',
    example: 'Laura Martínez',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    description: 'Handle o URL de Instagram',
    example: '@laurafit_es',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  instagram?: string;

  @ApiPropertyOptional({
    description: 'Handle o URL de TikTok',
    example: '@laurafit',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tiktok?: string;

  @ApiPropertyOptional({
    description: 'Handle o URL de YouTube',
    example: '@LauraFitChannel',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  youtube?: string;

  @ApiPropertyOptional({
    description: 'Código de país ISO 3166-1 alpha-2',
    example: 'ES',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiPropertyOptional({
    description: 'Código de idioma ISO 639-1',
    example: 'es',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  language?: string;

  @ApiPropertyOptional({
    description: 'Nicho principal de contenido',
    example: 'Fitness',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  niche?: string;

  @ApiPropertyOptional({
    description: 'Subnicho de contenido',
    example: 'Nutrición deportiva',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subNiche?: string;

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
    description: 'Tasa de engagement (0-100)',
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
    description: 'Correo de contacto comercial',
    example: 'laura@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'URL del media kit',
    example: 'https://example.com/mediakit/laura',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  mediaKitUrl?: string;
}
