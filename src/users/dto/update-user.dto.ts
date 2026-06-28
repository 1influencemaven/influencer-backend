import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Role } from '../../generated/prisma/enums';

export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'Nombre del usuario',
    example: 'María García',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Correo electrónico del usuario',
    example: 'usuario@ejemplo.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Contraseña del usuario (mínimo 8 caracteres)',
    example: 'MiContraseña123!',
  })
  @IsOptional()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({
    description: 'Rol del usuario',
    enum: Role,
    example: Role.USER,
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
