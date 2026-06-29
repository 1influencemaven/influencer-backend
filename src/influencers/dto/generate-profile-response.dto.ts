import { ApiProperty } from '@nestjs/swagger';

import { ProfileStatus } from '../../generated/prisma/enums';

export class GenerateProfileResponseDto {
  @ApiProperty({
    description: 'Mensaje de confirmación',
    example: 'Profile generation job enqueued',
  })
  message: string;

  @ApiProperty({
    description: 'Identificador del influencer',
    example: 'clx123abc456',
  })
  influencerId: string;

  @ApiProperty({
    description: 'Estado actual del perfil comercial',
    enum: ProfileStatus,
    example: ProfileStatus.PROCESSING,
  })
  profileStatus: ProfileStatus;
}
