import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { Role } from '../generated/prisma/enums';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

const userResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'clx123abc456' },
    name: { type: 'string', example: 'María García' },
    email: { type: 'string', example: 'usuario@ejemplo.com' },
    role: { type: 'string', enum: ['USER', 'ADMIN'], example: 'USER' },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-06-07T16:00:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-06-07T16:00:00.000Z',
    },
  },
};

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller({
  path: 'users',
  version: '1',
})
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({
    summary: 'Listar usuarios',
    description: 'Devuelve todos los usuarios de la plataforma.',
  })
  @ApiOkResponse({
    description: 'Lista de usuarios',
    schema: {
      type: 'array',
      items: userResponseSchema,
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @ApiOperation({
    summary: 'Obtener usuario',
    description: 'Devuelve un usuario por su identificador.',
  })
  @ApiOkResponse({
    description: 'Usuario encontrado',
    schema: userResponseSchema,
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiOperation({
    summary: 'Crear usuario',
    description: 'Crea una nueva cuenta de usuario.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({
    description: 'Usuario creado correctamente',
    schema: userResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'Datos de entrada inválidos' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @ApiOperation({
    summary: 'Actualizar usuario',
    description: 'Actualiza los datos de un usuario existente.',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({
    description: 'Usuario actualizado correctamente',
    schema: userResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'Datos de entrada inválidos' })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @ApiOperation({
    summary: 'Eliminar usuario',
    description: 'Elimina un usuario de la plataforma.',
  })
  @ApiOkResponse({
    description: 'Usuario eliminado correctamente',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'User deleted successfully',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({
    description: 'Permisos insuficientes o intento de auto-eliminación',
  })
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.usersService.remove(id, user.id);
  }
}
