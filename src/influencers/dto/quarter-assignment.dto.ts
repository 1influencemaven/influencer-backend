import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, Max, Min } from 'class-validator';

import { InfluencerQuarter } from '../../generated/prisma/enums';

export class QuarterAssignmentDto {
  @ApiProperty({
    description: 'Trimestre comercial',
    enum: InfluencerQuarter,
    example: InfluencerQuarter.Q1,
  })
  @IsEnum(InfluencerQuarter)
  quarter!: InfluencerQuarter;

  @ApiProperty({
    description: 'Año del trimestre',
    example: 2026,
    minimum: 2000,
    maximum: 2100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}
