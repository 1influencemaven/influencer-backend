import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGatewayTimeoutResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  IbpStatus,
  InfluencerDataOrigin,
  InfluencerQuarter,
  Role,
} from '../generated/prisma/enums';
import { CreateInfluencerDto } from './dto/create-influencer.dto';
import { QueryInfluencersDto } from './dto/query-influencers.dto';
import { ResearchInstagramUsernameDto } from './dto/research-instagram-username.dto';
import { UpdateInfluencerDto } from './dto/update-influencer.dto';
import { InfluencersService } from './influencers.service';
import { InstagramResearchService } from './instagram-research.service';

const ibpSummarySchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: Object.values(IbpStatus) },
    metadata: { type: 'object', nullable: true, additionalProperties: true },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const managerSchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string', enum: Object.values(Role) },
  },
};

const quarterSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    year: { type: 'integer', example: 2026 },
    quarter: { type: 'string', enum: Object.values(InfluencerQuarter) },
    assignedAt: { type: 'string', format: 'date-time' },
  },
};

const provenanceSchema = {
  type: 'object',
  properties: {
    fieldKey: { type: 'string', example: 'instagram' },
    origin: { type: 'string', enum: Object.values(InfluencerDataOrigin) },
    source: { type: 'string', nullable: true },
    fetchedAt: { type: 'string', format: 'date-time', nullable: true },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const influencerResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'clx123abc456' },
    name: { type: 'string', example: 'Laura Martínez' },
    instagram: { type: 'string', example: '@laurafit_es', nullable: true },
    instagramNormalized: {
      type: 'string',
      example: 'laurafit_es',
      nullable: true,
    },
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
    niches: {
      type: 'array',
      items: { type: 'string' },
      example: ['Fitness', 'Lifestyle'],
    },
    followers: { type: 'integer', example: 180000, nullable: true },
    engagement: { type: 'string', example: '4.50', nullable: true },
    email: { type: 'string', example: 'laura@example.com', nullable: true },
    outgoingEmail: {
      type: 'string',
      example: 'outreach@agency.com',
      nullable: true,
    },
    mediaKitUrl: {
      type: 'string',
      example: 'https://example.com/mediakit/laura',
      nullable: true,
    },
    managerId: { type: 'string', nullable: true },
    manager: managerSchema,
    quarterAssignments: { type: 'array', items: quarterSchema },
    fieldProvenances: { type: 'array', items: provenanceSchema },
    idealBrandProfile: ibpSummarySchema,
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
  constructor(
    private readonly influencersService: InfluencersService,
    private readonly instagramResearchService: InstagramResearchService,
  ) {}

  @ApiOperation({
    summary: 'Listar influencers / talentos',
    description:
      'Catálogo paginado con filtros, búsqueda (nombre/Instagram) y ordenamiento. Compatible con consumidores legacy.',
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
    summary: 'Listar managers elegibles',
    description:
      'Usuarios existentes que pueden asociarse como manager. No crea usuarios ni modifica roles.',
  })
  @ApiOkResponse({
    description: 'Lista de usuarios elegibles',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string', enum: Object.values(Role) },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Get('managers')
  findEligibleManagers() {
    return this.influencersService.findEligibleManagers();
  }

  @ApiOperation({
    summary: 'Investigar Instagram por username (consulta, sin persistir)',
    description:
      'Valida/normaliza el username, consulta Bright Data Instagram Profiles y ' +
      'devuelve campos del proveedor + vista normalizada. No crea ni actualiza influencers. ' +
      'Fase 1 HU-TM-003 (sin Mastra).',
  })
  @ApiBody({ type: ResearchInstagramUsernameDto })
  @ApiOkResponse({
    description: 'Perfil encontrado o privado (sin escritura en DB)',
    schema: {
      type: 'object',
      properties: {
        research: {
          type: 'object',
          properties: {
            outcome: {
              type: 'string',
              enum: [
                'FOUND',
                'PROFILE_PRIVATE',
                'PROFILE_NOT_FOUND',
                'INCOMPLETE_RESPONSE',
              ],
            },
            queriedUsername: { type: 'string' },
            handleNormalized: { type: 'string' },
            profileUrl: { type: 'string' },
            source: { type: 'string' },
            fetchedAt: { type: 'string', format: 'date-time' },
            persisted: { type: 'boolean', example: false },
          },
        },
        normalized: { type: 'object', additionalProperties: true },
        provider: { type: 'object', additionalProperties: true },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Username inválido' })
  @ApiNotFoundResponse({ description: 'Perfil Instagram no encontrado' })
  @ApiUnprocessableEntityResponse({
    description: 'Respuesta incompleta del proveedor',
  })
  @ApiGatewayTimeoutResponse({ description: 'Timeout Bright Data' })
  @ApiServiceUnavailableResponse({
    description: 'Bright Data no configurado o error de proveedor',
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Post('instagram-research')
  researchInstagramByUsername(@Body() dto: ResearchInstagramUsernameDto) {
    return this.instagramResearchService.researchByUsername(dto.username);
  }

  @ApiOperation({
    summary: 'Investigar perfil de Instagram de un talento existente',
    description:
      'Normaliza el handle del talento, consulta Bright Data Instagram Profiles desde Nest, ' +
      'mapea campos disponibles y aplica merge EXTERNAL sin sobrescribir MANUAL. ' +
      'No llama Bright Data desde el frontend.',
  })
  @ApiOkResponse({
    description:
      'Investigación completada (UPDATED / NO_CHANGES / PROFILE_PRIVATE)',
    schema: {
      type: 'object',
      properties: {
        influencer: influencerResponseSchema,
        research: {
          type: 'object',
          properties: {
            outcome: {
              type: 'string',
              enum: [
                'UPDATED',
                'NO_CHANGES',
                'PROFILE_PRIVATE',
                'PROFILE_NOT_FOUND',
                'INCOMPLETE_RESPONSE',
                'PROVIDER_ERROR',
                'PROVIDER_TIMEOUT',
                'NOT_CONFIGURED',
              ],
            },
            handle: { type: 'string' },
            profileUrl: { type: 'string' },
            source: { type: 'string' },
            fetchedAt: { type: 'string', format: 'date-time' },
            updatedFields: { type: 'array', items: { type: 'string' } },
            skippedManualFields: { type: 'array', items: { type: 'string' } },
            message: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Handle Instagram inválido o ausente' })
  @ApiNotFoundResponse({
    description: 'Talento o perfil Instagram no encontrado',
  })
  @ApiConflictResponse({
    description: 'Handle del proveedor choca con otro talento',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Respuesta incompleta del proveedor',
  })
  @ApiGatewayTimeoutResponse({ description: 'Timeout Bright Data' })
  @ApiServiceUnavailableResponse({
    description: 'Bright Data no configurado o error de proveedor',
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Post(':id/instagram-research')
  researchInstagram(@Param('id') id: string) {
    return this.instagramResearchService.researchByInfluencerId(id);
  }

  @ApiOperation({
    summary: 'Obtener influencer / talento',
    description:
      'Perfil completo: manager, trimestres, nichos, contacto y procedencia de campos.',
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
    summary: 'Registrar talento / influencer',
    description:
      'Instagram obligatorio (normalizado). Trimestres, nichos, manager y outgoingEmail opcionales según payload.',
  })
  @ApiBody({ type: CreateInfluencerDto })
  @ApiCreatedResponse({
    description: 'Influencer creado correctamente',
    schema: influencerResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'Datos de entrada inválidos' })
  @ApiConflictResponse({ description: 'Instagram duplicado' })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Post()
  create(@Body() createInfluencerDto: CreateInfluencerDto) {
    return this.influencersService.create(createInfluencerDto);
  }

  @ApiOperation({
    summary: 'Actualizar influencer / talento',
    description:
      'Actualiza campos manuales, trimestres (sin duplicar), nichos, manager y outgoingEmail. Procedencia MANUAL solo en campos modificados.',
  })
  @ApiBody({ type: UpdateInfluencerDto })
  @ApiOkResponse({
    description: 'Influencer actualizado correctamente',
    schema: influencerResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'Datos de entrada inválidos' })
  @ApiConflictResponse({ description: 'Instagram duplicado' })
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
}
