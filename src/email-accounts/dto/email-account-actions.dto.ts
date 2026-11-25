import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ReconnectEmailAccountsDto {
  @ApiProperty({ type: [String], example: ['XdPd8p1PVo'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  emailAccountIds!: string[];
}

/**
 * HU-EA-005. Only fields that are present are sent to Saleshandy (partial
 * update). Saleshandy requires a sender first name on every bulk update: when
 * `senderFirstName` is omitted each account keeps its current one.
 */
export class BulkUpdateEmailAccountsDto {
  @ApiProperty({ type: [String], example: ['XdPd8p1PVo'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  emailAccountIds!: string[];

  @ApiPropertyOptional({
    description: 'Omit to keep each account\'s current sender first name.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  senderFirstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderLastName?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  dailyQuota?: number;

  @ApiPropertyOptional({
    description: 'Comma-separated BCC emails. Empty string clears it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bcc?: string;

  @ApiPropertyOptional({ description: 'HTML signature. Empty string clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  signatureHtml?: string;

  @ApiPropertyOptional({ description: 'Seconds', example: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86400)
  sendingIntervalMin?: number;

  @ApiPropertyOptional({ description: 'Seconds', example: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86400)
  sendingIntervalMax?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  rampUpInitialSendingLimit?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  rampUpPercent?: number;

  @ApiPropertyOptional({ description: 'Saleshandy client id' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;
}
