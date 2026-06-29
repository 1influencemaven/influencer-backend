import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProfileStatus, Role } from '../generated/prisma/enums';
import { CreateInfluencerDto } from './dto/create-influencer.dto';
import { GenerateProfileResponseDto } from './dto/generate-profile-response.dto';
import { QueryInfluencersDto } from './dto/query-influencers.dto';
import { UpdateInfluencerDto } from './dto/update-influencer.dto';
import { InfluencersService } from './influencers.service';

const commercialProfileSchema = {
  type: 'object',
  properties: {
    idealBrands: {
      type: 'array',
      items: { type: 'string' },
      example: ['Sportswear brands', 'Wellness apps'],
    },
    brandSize: {
      type: 'array',
      items: { type: 'string' },
      example: ['smb', 'mid_market'],
    },
    departments: {
      type: 'array',
      items: { type: 'string' },
      example: ['marketing', 'brand'],
    },
    buyerPersonas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', example: 'Marketing Manager' },
          seniority: { type: 'string', example: 'mid' },
          responsibilities: {
            type: 'array',
            items: { type: 'string' },
            example: ['influencer partnerships'],
          },
        },
      },
    },
    futureMetadata: {
      type: 'object',
      additionalProperties: true,
    },
  },
};

const influencerResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'clx123abc456' },
    name: { type: 'string', example: 'Laura Martínez' },
    instagram: { type: 'string', example: '@laurafit_es', nullable: true },
    tiktok: { type: 'string', example: '@laurafit', nullable: true },
    youtube: { type: 'string', example: '@LauraFitChannel', nullable: true },
    country: { type: 'string', example: 'ES', nullable: true },
    language: { type: 'string', example: 'es', nullable: true },
    niche: { type: 'string', example: 'Fitness', nullable: true },
    subNiche: {
      type: 'string',
      example: 'Nutrición deportiva',
      nullable: true,
    },
    followers: { type: 'integer', example: 180000, nullable: true },
    engagement: { type: 'string', example: '4.50', nullable: true },
    email: { type: 'string', example: 'laura@example.com', nullable: true },
    mediaKitUrl: {
      type: 'string',
      example: 'https://example.com/mediakit/laura',
      nullable: true,
    },
    profileStatus: {
      type: 'string',
      enum: Object.values(ProfileStatus),
      example: ProfileStatus.PENDING,
    },
    commercialProfile: {
      ...commercialProfileSchema,
      nullable: true,
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-06-28T12:00:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-06-28T12:00:00.000Z',
    },
  },
};

const paginatedInfluencersSchema = {
  type: 'object',
  properties: {
    data: {
      type: 'array',
      items: influencerResponseSchema,
    },
    meta: {
      type: 'object',
      properties: {
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
        total: { type: 'integer', example: 42 },
        totalPages: { type: 'integer', example: 3 },
      },
    },
  },
};

@ApiTags('Influencers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
@Controller({
  path: 'influencers',
  version: '1',
})
export class InfluencersController {
  constructor(private readonly influencersService: InfluencersService) {}

  @ApiOperation({
    summary: 'Listar influencers',
    description:
      'Devuelve influencers paginados con filtros, búsqueda y ordenamiento.',
  })
  @ApiOkResponse({
    description: 'Lista paginada de influencers',
    schema: paginatedInfluencersSchema,
  })
  @ApiBadRequestResponse({ description: 'Parámetros de consulta inválidos' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Get()
  findAll(@Query() query: QueryInfluencersDto) {
    return this.influencersService.findAll(query);
  }

  @ApiOperation({
    summary: 'Obtener influencer',
    description: 'Devuelve un influencer por su identificador.',
  })
  @ApiOkResponse({
    description: 'Influencer encontrado',
    schema: influencerResponseSchema,
  })
  @ApiNotFoundResponse({ description: 'Influencer no encontrado' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.influencersService.findOne(id);
  }

  @ApiOperation({
    summary: 'Crear influencer',
    description: 'Crea un nuevo influencer con perfil comercial pendiente.',
  })
  @ApiBody({ type: CreateInfluencerDto })
  @ApiCreatedResponse({
    description: 'Influencer creado correctamente',
    schema: influencerResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'Datos de entrada inválidos' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Post()
  create(@Body() createInfluencerDto: CreateInfluencerDto) {
    return this.influencersService.create(createInfluencerDto);
  }

  @ApiOperation({
    summary: 'Actualizar influencer',
    description: 'Actualiza los datos de un influencer existente.',
  })
  @ApiBody({ type: UpdateInfluencerDto })
  @ApiOkResponse({
    description: 'Influencer actualizado correctamente',
    schema: influencerResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'Datos de entrada inválidos' })
  @ApiNotFoundResponse({ description: 'Influencer no encontrado' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateInfluencerDto: UpdateInfluencerDto,
  ) {
    return this.influencersService.update(id, updateInfluencerDto);
  }

  @ApiOperation({
    summary: 'Eliminar influencer',
    description: 'Elimina un influencer de la plataforma.',
  })
  @ApiOkResponse({
    description: 'Influencer eliminado correctamente',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Influencer deleted successfully',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Influencer no encontrado' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.influencersService.remove(id);
  }

  @ApiOperation({
    summary: 'Generar perfil comercial',
    description:
      'Encola un job asíncrono para generar el perfil comercial del influencer.',
  })
  @ApiAcceptedResponse({
    description: 'Job de generación encolado correctamente',
    type: GenerateProfileResponseDto,
  })
  @ApiConflictResponse({
    description: 'Ya existe una generación en curso para este influencer',
  })
  @ApiNotFoundResponse({ description: 'Influencer no encontrado' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post(':id/generate-profile')
  generateProfile(@Param('id') id: string) {
    return this.influencersService.generateProfile(id);
  }
}
