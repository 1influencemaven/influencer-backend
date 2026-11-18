import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

import { CreateInfluencerDto } from './create-influencer.dto';

export class UpdateInfluencerDto extends PartialType(
  OmitType(CreateInfluencerDto, [
    'managerId',
    'instagramResearch',
  ] as const),
) {
  @ApiPropertyOptional({
    description:
      'Usuario manager (User.id). `null` desasocia el manager. No crea usuarios.',
    nullable: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  managerId?: string | null;
}
