import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Normalized Instagram lookup fields carried into create (phase 1.1).
 * Hashtags are evidence only — never auto-promoted to niches.
 */
export class InstagramResearchNormalizedDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  account?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  biography?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  followers?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  following?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  postsCount?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Contact email from Instagram (not outgoingEmail)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  emailAddress?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  profileImageUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  profileUrl?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  externalUrls?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  bioHashtags?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  postHashtags?: string[];
}

/**
 * Research package from username lookup. Stored only when the user confirms create.
 * Lookup endpoint itself remains persisted:false.
 */
export class InstagramResearchEvidenceDto {
  @ApiProperty({
    description: 'Bright Data / research source id',
    example: 'brightdata:instagram:gd_l1vikfch901nx3by4',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  source!: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp of the lookup',
    example: '2026-11-13T20:00:00.000Z',
  })
  @IsISO8601()
  fetchedAt!: string;

  @ApiProperty({ example: 'pixel.vnzla' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  handleNormalized!: string;

  @ApiProperty({ example: 'https://www.instagram.com/pixel.vnzla/' })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  profileUrl!: string;

  @ApiProperty({ type: InstagramResearchNormalizedDto })
  @ValidateNested()
  @Type(() => InstagramResearchNormalizedDto)
  normalized!: InstagramResearchNormalizedDto;
}
