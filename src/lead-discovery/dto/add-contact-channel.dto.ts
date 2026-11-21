import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

import {
  ContactChannelSource,
  ContactChannelType,
} from '../../generated/prisma/enums';

export class AddContactChannelDto {
  @ApiProperty({ enum: ContactChannelType })
  @IsEnum(ContactChannelType)
  type!: ContactChannelType;

  @ApiProperty({ description: 'Email address or URL depending on type' })
  @IsString()
  @MinLength(1)
  value!: string;

  @ApiProperty({ enum: ContactChannelSource })
  @IsEnum(ContactChannelSource)
  source!: ContactChannelSource;

  @ApiPropertyOptional({
    description: 'Source page URL (e.g. public web evidence)',
  })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiPropertyOptional({ description: 'Only for EMAIL channels' })
  @IsOptional()
  @IsBoolean()
  isGeneric?: boolean;

  @ApiPropertyOptional({
    description:
      'For PUBLIC_WEB email: { evidences: [{ evidenceSnippet, sourceUrl?, discoveredAt? }] }',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
