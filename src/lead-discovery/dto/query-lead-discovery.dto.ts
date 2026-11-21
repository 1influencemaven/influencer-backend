import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import {
  AgencyContactKind,
  CommercialRelevance,
  LeadStatus,
} from '../../generated/prisma/enums';

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

/** 2C.4.7 — read-only AgencyContact commercial list by influencer. */
export class QueryAgencyContactsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  influencerId!: string;

  @ApiPropertyOptional({ enum: AgencyContactKind })
  @IsOptional()
  @IsEnum(AgencyContactKind)
  contactKind?: AgencyContactKind;

  @ApiPropertyOptional({ enum: CommercialRelevance })
  @IsOptional()
  @IsEnum(CommercialRelevance)
  commercialRelevance?: CommercialRelevance;
}
