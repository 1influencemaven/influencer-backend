import { ApiPropertyOptional } from '@nestjs/swagger';
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
