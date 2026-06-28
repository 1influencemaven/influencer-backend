import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Role } from '../../generated/prisma/enums';

export class CreateUserDto {
  @ApiProperty({
    description: 'Nombre del usuario',
    example: 'María García',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Correo electrónico del usuario',
    example: 'usuario@ejemplo.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Contraseña del usuario (mínimo 8 caracteres)',
    example: 'MiContraseña123!',
  })
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    description: 'Rol del usuario',
    enum: Role,
    default: Role.USER,
    example: Role.USER,
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
