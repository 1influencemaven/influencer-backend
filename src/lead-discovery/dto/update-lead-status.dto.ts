import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { LeadStatus } from '../../generated/prisma/enums';

const UPDATABLE = [
  LeadStatus.APPROVED,
  LeadStatus.DISCARDED,
  LeadStatus.DUPLICATE,
] as const;

export class UpdateLeadStatusDto {
  @ApiProperty({
    enum: UPDATABLE,
    description: 'Estado de revisión humana',
  })
  @IsEnum(UPDATABLE)
  status!: (typeof UPDATABLE)[number];
}
