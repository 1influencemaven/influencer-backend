import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { BrandCandidateStatus } from '../../generated/prisma/enums';

export class UpdateBrandCandidateStatusDto {
  @ApiProperty({
    enum: [
      BrandCandidateStatus.APPROVED,
      BrandCandidateStatus.REJECTED,
      BrandCandidateStatus.POSTPONED,
    ],
    description: 'Nuevo estado de revisión humana',
  })
  @IsEnum([
    BrandCandidateStatus.APPROVED,
    BrandCandidateStatus.REJECTED,
    BrandCandidateStatus.POSTPONED,
  ])
  status!:
    | typeof BrandCandidateStatus.APPROVED
    | typeof BrandCandidateStatus.REJECTED
    | typeof BrandCandidateStatus.POSTPONED;
}
