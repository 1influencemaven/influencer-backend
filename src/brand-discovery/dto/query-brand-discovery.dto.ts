import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { BrandCandidateStatus } from '../../generated/prisma/enums';

export class QueryBrandCandidatesDto {
  @ApiPropertyOptional({ description: 'Filtrar por influencer' })
  @IsOptional()
  @IsUUID('4')
  influencerId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por run de discovery' })
  @IsOptional()
  @IsUUID('4')
  runId?: string;

  @ApiPropertyOptional({ enum: BrandCandidateStatus })
  @IsOptional()
  @IsEnum(BrandCandidateStatus)
  status?: BrandCandidateStatus;
}

export class QueryBrandDiscoveryRunsDto {
  @ApiPropertyOptional({ description: 'Filtrar por influencer' })
  @IsOptional()
  @IsUUID('4')
  influencerId?: string;
}
