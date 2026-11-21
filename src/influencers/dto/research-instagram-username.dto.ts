import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ResearchInstagramUsernameDto {
  @ApiProperty({
    description:
      'Username, handle (@user) o URL de Instagram a investigar. No crea ni actualiza talentos.',
    example: 'belu.deltoro',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;
}
