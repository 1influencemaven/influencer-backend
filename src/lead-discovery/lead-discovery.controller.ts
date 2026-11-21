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
import { AgencyContactCommercialReaderService } from '../agency-discovery/agency-contact-commercial-reader.service';
import {
  QueryAgencyContactsDto,
  QueryBrandBusinessContactsDto,
  QueryLeadDiscoveryRunsDto,
  QueryLeadsDto,
} from './dto/query-lead-discovery.dto';
import { SearchLeadsDto } from './dto/search-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { AddContactChannelDto } from './dto/add-contact-channel.dto';
import { BrandBusinessContactService } from './brand-business-contact.service';
import {
  UnlockerDiagnosticRequestDto,
  UnlockerDiagnosticResponseDto,
} from './dto/unlocker-diagnostic.dto';
import { LeadDiscoveryService } from './lead-discovery.service';
import { UnlockerDiagnosticsService } from './unlocker-diagnostics.service';

@ApiTags('Lead Discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
@Controller({ path: 'lead-discovery', version: '1' })
export class LeadDiscoveryController {
  constructor(
    private readonly leadDiscoveryService: LeadDiscoveryService,
    private readonly brandBusinessContactService: BrandBusinessContactService,
    private readonly agencyContactCommercialReader: AgencyContactCommercialReaderService,
    private readonly unlockerDiagnosticsService: UnlockerDiagnosticsService,
  ) {}

  @ApiOperation({ summary: 'Listar providers de leads disponibles' })
  @ApiOkResponse({ description: 'Providers configurados' })
  @Get('providers')
  listProviders() {
    return this.leadDiscoveryService.listProviders();
  }

  @ApiOperation({
    summary: 'Sonda Unlocker (diagnóstico ADMIN, local)',
    description:
      'Una sola llamada a fetchRawHtml para la URL allowlisted. ' +
      'Requiere ADMIN, NODE_ENV≠production y UNLOCKER_DIAGNOSTICS_ENABLED=true. ' +
      'No persiste en DB; no ejecuta 2A/2B/PEE. Respuesta sin HTML ni secretos.',
  })
  @ApiOkResponse({
    description: 'Resultado tipado de la sonda (sin cuerpo HTML)',
    type: UnlockerDiagnosticResponseDto,
  })
  @ApiBadRequestResponse({ description: 'URL fuera de allowlist' })
  @ApiForbiddenResponse({
    description: 'No ADMIN, producción, o diagnóstico deshabilitado',
  })
  @ApiServiceUnavailableResponse({ description: 'Unlocker no configurado' })
  @ApiUnauthorizedResponse({ description: 'No autenticado' })
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('diagnostics/unlocker')
  probeUnlocker(
    @Body() dto: UnlockerDiagnosticRequestDto,
  ): Promise<UnlockerDiagnosticResponseDto> {
    return this.unlockerDiagnosticsService.probe(dto.url);
  }

  @ApiOperation({
    summary: 'Listar contactos comerciales de marca (BrandBusinessContact)',
    description:
      'Visibility v2 Phase 1. Buzones de marca sin persona (ADR-0016/0018). ' +
      'No son Leads. 404 si la marca no existe; [] si no hay contactos.',
  })
  @ApiOkResponse({
    description: 'Lista de BrandBusinessContact (posiblemente vacía)',
  })
  @ApiBadRequestResponse({ description: 'brandCandidateId inválido' })
  @ApiNotFoundResponse({ description: 'Marca candidata no encontrada' })
  @ApiUnauthorizedResponse({ description: 'No autenticado' })
  @Get('business-contacts')
  listBusinessContacts(@Query() query: QueryBrandBusinessContactsDto) {
    return this.brandBusinessContactService.listByBrandCandidateId(
      query.brandCandidateId,
    );
  }

  @ApiOperation({
    summary: 'Listar contactos comerciales de agencias (AgencyContact)',
    description:
      '2C.4.7 read-only. Filtra por InfluencerAgency del influencer (RELEVANT/UNDER_REVIEW). ' +
      'No crea Leads ni ContactChannels; no dispara Mastra/Bright Data. ' +
      '404 si el influencer no existe; [] si no hay contactos visibles.',
  })
  @ApiOkResponse({
    description: 'Lista de AgencyContact comerciales (posiblemente vacía)',
  })
  @ApiBadRequestResponse({ description: 'influencerId inválido' })
  @ApiNotFoundResponse({ description: 'Influencer no encontrado' })
  @ApiUnauthorizedResponse({ description: 'No autenticado' })
  @Get('agency-contacts')
  listAgencyContacts(@Query() query: QueryAgencyContactsDto) {
    return this.agencyContactCommercialReader.listForInfluencer({
      influencerId: query.influencerId,
      contactKind: query.contactKind,
      commercialRelevance: query.commercialRelevance,
    });
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
      'Paso 5b: siempre encola Contact Discovery (cola contact-discovery / FIND_BRAND_EMAILS via Mastra). No hay find-leads ni Nest BBC legacy.',
  })
  @ApiAcceptedResponse({ description: 'Jobs encolados' })
  @ApiBadRequestResponse({
    description: 'Marca no APPROVED u options inválidas',
  })
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

  @ApiOperation({
    summary: 'Listar leads',
    description:
      'Incluye `selectedForOutreach` derivado de BrandCandidate.selectedLeadId (ADR-0011).',
  })
  @ApiOkResponse({ description: 'Lista de leads' })
  @Get('leads')
  listLeads(@Query() query: QueryLeadsDto) {
    return this.leadDiscoveryService.listLeads(query);
  }

  @ApiOperation({
    summary: 'Obtener lead con canales de contacto',
    description:
      'Incluye contactChannels, outreachReadiness (D1: READY nunca asignado) y campos legacy email/profileUrl.',
  })
  @ApiOkResponse({ description: 'Detalle del lead' })
  @ApiNotFoundResponse({ description: 'Lead no encontrado' })
  @Get('leads/:id')
  getLeadById(@Param('id') id: string) {
    return this.leadDiscoveryService.getLeadById(id);
  }

  @ApiOperation({
    summary: 'Agregar canal de contacto a un lead',
    description:
      'EMAIL con source PUBLIC_WEB requiere metadata.evidences con email literal.',
  })
  @ApiOkResponse({ description: 'Lead actualizado con el nuevo canal' })
  @ApiConflictResponse({ description: 'Canal duplicado' })
  @ApiBadRequestResponse({ description: 'Validación o evidencia inválida' })
  @ApiNotFoundResponse({ description: 'Lead no encontrado' })
  @Post('leads/:id/contact-channels')
  addContactChannel(
    @Param('id') id: string,
    @Body() dto: AddContactChannelDto,
  ) {
    return this.leadDiscoveryService.addContactChannel(id, dto);
  }

  @ApiOperation({
    summary: 'Seleccionar lead APPROVED para outreach futuro',
    description:
      'Establece BrandCandidate.selectedLeadId = lead.id (exclusivo). No envía email.',
  })
  @ApiOkResponse({
    description: 'Lead seleccionado (selectedForOutreach=true)',
  })
  @ApiBadRequestResponse({
    description: 'Lead no APPROVED',
  })
  @ApiNotFoundResponse({ description: 'Lead no encontrado' })
  @Post('leads/:id/select')
  selectForOutreach(@Param('id') id: string) {
    return this.leadDiscoveryService.selectLeadForOutreach(id);
  }

  @ApiOperation({
    summary: 'Deseleccionar lead como destino de outreach',
    description:
      'Pone BrandCandidate.selectedLeadId = null si este lead era el seleccionado. No cambia Lead.status.',
  })
  @ApiOkResponse({
    description: 'Lead deseleccionado (selectedForOutreach=false)',
  })
  @ApiBadRequestResponse({
    description: 'Lead no es el actualmente seleccionado',
  })
  @ApiNotFoundResponse({ description: 'Lead no encontrado' })
  @Delete('leads/:id/select')
  deselectForOutreach(@Param('id') id: string) {
    return this.leadDiscoveryService.deselectLeadForOutreach(id);
  }

  @ApiOperation({
    summary: 'Aprobar, descartar o marcar duplicado',
    description:
      'DISCARDED/DUPLICATE limpian selectedLeadId si este lead era el seleccionado.',
  })
  @ApiOkResponse({ description: 'Lead actualizado' })
  @ApiNotFoundResponse({ description: 'Lead no encontrado' })
  @Patch('leads/:id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateLeadStatusDto) {
    return this.leadDiscoveryService.updateLeadStatus(id, dto);
  }
}
