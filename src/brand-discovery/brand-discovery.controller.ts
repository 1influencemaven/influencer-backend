import {
  Body,
  Controller,
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
  ApiBearerAuth,
  ApiBadRequestResponse,
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
import { Role } from '../generated/prisma/enums';
import { BrandDiscoveryService } from './brand-discovery.service';
import {
  QueryBrandCandidatesDto,
  QueryBrandDiscoveryRunsDto,
} from './dto/query-brand-discovery.dto';
import { SearchBrandsDto } from './dto/search-brands.dto';
import { UpdateBrandCandidateStatusDto } from './dto/update-brand-candidate-status.dto';

@ApiTags('Brand Discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
@Controller({ path: 'brand-discovery', version: '1' })
export class BrandDiscoveryController {
  constructor(private readonly brandDiscoveryService: BrandDiscoveryService) {}

  @ApiOperation({
    summary: 'Buscar marcas para influencers',
    description:
      'Encola discovery automático (Tavily + LLM) por cada influencer con IBP ACTIVE. Acepta `limit` (1–20). No busca correos.',
  })
  @ApiAcceptedResponse({ description: 'Jobs encolados' })
  @ApiBadRequestResponse({
    description: 'IBP no ACTIVE, limit inválido u otro error de negocio',
  })
  @ApiConflictResponse({ description: 'Ya hay un discovery en curso' })
  @ApiNotFoundResponse({ description: 'Influencer no encontrado' })
  @ApiUnauthorizedResponse({ description: 'No autenticado' })
  @ApiForbiddenResponse({ description: 'Sin permisos' })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('search')
  search(@Body() dto: SearchBrandsDto) {
    return this.brandDiscoveryService.search(dto);
  }

  @ApiOperation({ summary: 'Listar runs de discovery (polling)' })
  @ApiOkResponse({ description: 'Lista de runs' })
  @Get('runs')
  listRuns(@Query() query: QueryBrandDiscoveryRunsDto) {
    return this.brandDiscoveryService.listRuns(query.influencerId);
  }

  @ApiOperation({ summary: 'Listar marcas candidatas' })
  @ApiOkResponse({ description: 'Lista de candidatas' })
  @Get('candidates')
  listCandidates(@Query() query: QueryBrandCandidatesDto) {
    return this.brandDiscoveryService.listCandidates(query);
  }

  @ApiOperation({ summary: 'Aprobar, rechazar o posponer candidata' })
  @ApiOkResponse({ description: 'Candidata actualizada' })
  @ApiNotFoundResponse({ description: 'Candidata no encontrada' })
  @Patch('candidates/:id')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBrandCandidateStatusDto,
  ) {
    return this.brandDiscoveryService.updateCandidateStatus(id, dto);
  }
}
