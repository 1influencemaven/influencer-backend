import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthUser } from './interfaces/auth-user.interface';

@ApiTags('Auth')
@Controller({
  path: 'auth',
  version: '1',
})
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @ApiOperation({
    summary: 'Registrar usuario',
    description:
      'Crea una nueva cuenta de usuario con correo electrónico, contraseña y rol opcional. La contraseña se almacena de forma segura y no se incluye en la respuesta.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'Usuario registrado correctamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'clx123abc456' },
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
    },
  })
  @ApiBadRequestResponse({
    description: 'Datos de entrada inválidos',
  })
  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'Autentica al usuario con correo y contraseña. En caso de éxito, establece las cookies httpOnly access_token y refresh_token y devuelve los datos del usuario.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Sesión iniciada correctamente',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clx123abc456' },
            email: { type: 'string', example: 'usuario@ejemplo.com' },
            role: { type: 'string', enum: ['USER', 'ADMIN'], example: 'USER' },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Credenciales inválidas',
  })
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } =
      await this.authService.login(loginDto);

    this.authCookieService.set(res, accessToken, refreshToken);

    return { user };
  }

  @ApiOperation({
    summary: 'Renovar tokens',
    description:
      'Renueva el access token y el refresh token utilizando la cookie refresh_token. En caso de éxito, actualiza las cookies httpOnly y devuelve los datos del usuario.',
  })
  @ApiOkResponse({
    description: 'Tokens renovados correctamente',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clx123abc456' },
            email: { type: 'string', example: 'usuario@ejemplo.com' },
            role: { type: 'string', enum: ['USER', 'ADMIN'], example: 'USER' },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Refresh token inválido, expirado o no encontrado',
  })
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token as string | undefined;

    const { accessToken, refreshToken: newRefreshToken, user } =
      await this.authService.refresh(refreshToken);

    this.authCookieService.set(res, accessToken, newRefreshToken);

    return { user };
  }

  @ApiOperation({
    summary: 'Cerrar sesión',
    description:
      'Invalida el refresh token asociado a la cookie refresh_token y elimina las cookies de autenticación del cliente.',
  })
  @ApiOkResponse({
    description: 'Sesión cerrada correctamente',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Logged out successfully',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token de actualización inválido o ausente',
  })
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token as string | undefined;

    await this.authService.logout(refreshToken);

    this.authCookieService.clear(res);

    return { message: 'Logged out successfully' };
  }

  @ApiOperation({
    summary: 'Obtener usuario autenticado',
    description:
      'Devuelve los datos del usuario asociado al token de acceso proporcionado.',
  })
  @ApiBearerAuth()
  @ApiOkResponse({
    description: 'Datos del usuario autenticado',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'clx123abc456' },
        email: { type: 'string', example: 'usuario@ejemplo.com' },
        role: { type: 'string', enum: ['USER', 'ADMIN'], example: 'USER' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return user;
  }
}
