import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
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
import { IbpStatus, Role } from '../generated/prisma/enums';
import {
  GenerateIbpResponseDto,
  UpdateIdealBrandProfileDto,
} from './dto/update-ideal-brand-profile.dto';
import { IdealBrandProfilesService } from './ideal-brand-profiles.service';

const ibpResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    influencerId: { type: 'string' },
    status: { type: 'string', enum: Object.values(IbpStatus) },
    targetSectors: { type: 'array', items: { type: 'string' } },
    excludedSectors: { type: 'array', items: { type: 'string' } },
    brandSize: { type: 'array', items: { type: 'string' } },
    markets: { type: 'array', items: { type: 'string' } },
    collaborationTypes: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    alertSignals: { type: 'array', items: { type: 'string' } },
    desirableCriteria: { type: 'array', items: { type: 'string' } },
    metadata: { type: 'object', nullable: true, additionalProperties: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

@ApiTags('Ideal Brand Profiles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
@Controller({
  path: 'influencers/:influencerId/ideal-brand-profile',
  version: '1',
})
export class IdealBrandProfilesController {
  constructor(
    private readonly idealBrandProfilesService: IdealBrandProfilesService,
  ) {}

  @ApiOperation({
    summary: 'Obtener perfil ideal de marca',
    description: 'Devuelve el IBP del influencer si existe.',
  })
  @ApiOkResponse({
    description: 'Perfil ideal encontrado',
    schema: ibpResponseSchema,
  })
  @ApiNotFoundResponse({
    description: 'Perfil ideal o influencer no encontrado',
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Get()
  findOne(@Param('influencerId') influencerId: string) {
    return this.idealBrandProfilesService.findByInfluencerId(influencerId);
  }

  @ApiOperation({
    summary: 'Generar perfil ideal con IA',
    description: 'Encola la primera generación del IBP para el influencer.',
  })
  @ApiAcceptedResponse({
    description: 'Job de generación encolado',
    type: GenerateIbpResponseDto,
  })
  @ApiConflictResponse({
    description: 'Ya hay una generación en curso',
  })
  @ApiNotFoundResponse({ description: 'Influencer no encontrado' })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('generate')
  generate(@Param('influencerId') influencerId: string) {
    return this.idealBrandProfilesService.generate(influencerId);
  }

  @ApiOperation({
    summary: 'Regenerar perfil ideal con IA',
    description:
      'Vuelve a generar el IBP usando los datos actuales del influencer.',
  })
  @ApiAcceptedResponse({
    description: 'Job de regeneración encolado',
    type: GenerateIbpResponseDto,
  })
  @ApiConflictResponse({
    description: 'Ya hay una generación en curso',
  })
  @ApiNotFoundResponse({ description: 'Influencer no encontrado' })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('regenerate')
  regenerate(@Param('influencerId') influencerId: string) {
    return this.idealBrandProfilesService.regenerate(influencerId);
  }

  @ApiOperation({
    summary: 'Guardar perfil ideal',
    description: 'Guarda las ediciones del usuario y marca el IBP como ACTIVE.',
  })
  @ApiBody({ type: UpdateIdealBrandProfileDto })
  @ApiOkResponse({
    description: 'Perfil ideal guardado',
    schema: ibpResponseSchema,
  })
  @ApiConflictResponse({
    description: 'No se puede guardar mientras hay generación en curso',
  })
  @ApiNotFoundResponse({ description: 'Perfil ideal no encontrado' })
  @Patch()
  save(
    @Param('influencerId') influencerId: string,
    @Body() dto: UpdateIdealBrandProfileDto,
  ) {
    return this.idealBrandProfilesService.save(influencerId, dto);
  }
}
