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
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../generated/prisma/enums';
import {
  QueryLeadDiscoveryRunsDto,
  QueryLeadsDto,
} from './dto/query-lead-discovery.dto';
import { SearchLeadsDto } from './dto/search-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadDiscoveryService } from './lead-discovery.service';

@ApiTags('Lead Discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
@Controller({ path: 'lead-discovery', version: '1' })
export class LeadDiscoveryController {
  constructor(private readonly leadDiscoveryService: LeadDiscoveryService) {}

  @ApiOperation({ summary: 'Listar providers de leads disponibles' })
  @ApiOkResponse({ description: 'Providers configurados' })
  @Get('providers')
  listProviders() {
    return this.leadDiscoveryService.listProviders();
  }

  @ApiOperation({
    summary: 'Listar opciones de un provider (datasets Bright Data, etc.)',
  })
  @ApiOkResponse({ description: 'Opciones del provider' })
  @ApiNotFoundResponse({ description: 'Provider desconocido' })
  @ApiServiceUnavailableResponse({ description: 'Provider no configurado' })
  @Get('providers/:id/options')
  listProviderOptions(@Param('id') id: string) {
    return this.leadDiscoveryService.listProviderOptions(id);
  }

  @ApiOperation({
    summary: 'Buscar contactos/emails en marcas APPROVED',
    description:
      'Encola find-leads por marca. Default provider ai+brightdata (autónomo; sin options). Manual brightdata requiere options.optionIds.',
  })
  @ApiAcceptedResponse({ description: 'Jobs encolados' })
  @ApiBadRequestResponse({ description: 'Marca no APPROVED u options inválidas' })
  @ApiConflictResponse({ description: 'Ya hay un run PROCESSING' })
  @ApiNotFoundResponse({ description: 'Marca no encontrada' })
  @ApiServiceUnavailableResponse({ description: 'Provider no configurado' })
  @ApiUnauthorizedResponse({ description: 'No autenticado' })
  @ApiForbiddenResponse({ description: 'Sin permisos' })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('search')
  search(@Body() dto: SearchLeadsDto) {
    return this.leadDiscoveryService.search(dto);
  }

  @ApiOperation({ summary: 'Listar runs de Lead Discovery (polling)' })
  @ApiOkResponse({ description: 'Lista de runs' })
  @Get('runs')
  listRuns(@Query() query: QueryLeadDiscoveryRunsDto) {
    return this.leadDiscoveryService.listRuns(query);
  }

  @ApiOperation({ summary: 'Listar leads' })
  @ApiOkResponse({ description: 'Lista de leads' })
  @Get('leads')
  listLeads(@Query() query: QueryLeadsDto) {
    return this.leadDiscoveryService.listLeads(query);
  }

  @ApiOperation({ summary: 'Aprobar, descartar o marcar duplicado' })
  @ApiOkResponse({ description: 'Lead actualizado' })
  @ApiNotFoundResponse({ description: 'Lead no encontrado' })
  @Patch('leads/:id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateLeadStatusDto) {
    return this.leadDiscoveryService.updateLeadStatus(id, dto);
  }
}
