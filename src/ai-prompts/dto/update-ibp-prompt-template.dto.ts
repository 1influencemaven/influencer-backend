import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateIbpPromptTemplateDto {
  @ApiProperty({
    description: 'Instrucciones de negocio editables para generación de IBP',
    example:
      'You are a commercial strategist for influencer marketing agencies...',
    minLength: 1,
    maxLength: 8000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  instructions: string;
}
