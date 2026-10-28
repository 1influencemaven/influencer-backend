import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { LeadStatus } from '../../generated/prisma/enums';

export class QueryLeadDiscoveryRunsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  brandCandidateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  influencerId?: string;
}

export class QueryLeadsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  brandCandidateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  influencerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  runId?: string;

  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;
}

/** Visibility (Lead Discovery v2 Phase 1) — list BrandBusinessContact by brand. */
export class QueryBrandBusinessContactsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  brandCandidateId!: string;
}
