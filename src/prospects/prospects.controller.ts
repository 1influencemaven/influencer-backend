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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { Role } from '../generated/prisma/enums';
import { InfluencerAccessService } from '../influencers/access/influencer-access.service';
import {
  ApprovedIdsQueryDto,
  ApproveProspectsDto,
  CreateProspectDto,
  ImportProspectsCsvDto,
  QueryProspectsDto,
  UpdateProspectDto,
} from './dto/prospects.dto';
import { ProspectsCsvService } from './prospects-csv.service';
import { ProspectsIngestionService } from './prospects-ingestion.service';
import { ProspectsService } from './prospects.service';

/**
 * Prospects per talent: approved discovered contacts + CSV imports.
 * USER and ADMIN can read and edit (templates/outreach are written by managers).
 */
@ApiTags('Prospects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
@Controller({ path: 'prospects', version: '1' })
export class ProspectsController {
  constructor(
    private readonly prospects: ProspectsService,
    private readonly ingestion: ProspectsIngestionService,
    private readonly csv: ProspectsCsvService,
    private readonly access: InfluencerAccessService,
  ) {}

  @ApiOperation({
    summary:
      'Listar prospectos (filtros por talento, marca, origen, tipo, estado)',
  })
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: QueryProspectsDto) {
    return this.prospects.list(user, query);
  }

  @ApiOperation({
    summary:
      'IDs de contactos ya aprobados como prospectos (estado de los botones)',
  })
  @Get('approved-ids')
  async approvedIds(
    @CurrentUser() user: AuthUser,
    @Query() query: ApprovedIdsQueryDto,
  ) {
    await this.access.assertCanAccess(user, query.influencerId);
    return this.ingestion.approvedIds(query.influencerId);
  }

  @ApiOperation({ summary: 'Historial de importaciones CSV' })
  @Get('import-jobs')
  importJobs(
    @CurrentUser() user: AuthUser,
    @Query('influencerId') influencerId?: string,
  ) {
    return this.prospects.importJobs(user, influencerId);
  }

  @ApiOperation({
    summary:
      'Aprobar contactos encontrados → prospectos (personas, correos de marca, agencias)',
  })
  @HttpCode(HttpStatus.OK)
  @Post('approve')
  async approve(
    @CurrentUser() user: AuthUser,
    @Body() dto: ApproveProspectsDto,
  ) {
    const influencerIds = [
      ...new Set(
        dto.items.map((i) => i.influencerId).filter((v): v is string => !!v),
      ),
    ];
    for (const id of influencerIds) await this.access.assertCanAccess(user, id);
    return { results: await this.ingestion.approve(dto.items, user.id) };
  }

  @ApiOperation({
    summary: 'Quitar contactos de prospectos (archiva, conserva historial)',
  })
  @HttpCode(HttpStatus.OK)
  @Post('unapprove')
  unapprove(@Body() dto: ApproveProspectsDto) {
    return this.ingestion.unapprove(dto.items);
  }

  @ApiOperation({
    summary: 'Importar prospectos desde CSV ya mapeado a Fields',
  })
  @HttpCode(HttpStatus.OK)
  @Post('import-csv')
  async importCsv(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImportProspectsCsvDto,
  ) {
    await this.access.assertCanAccess(user, dto.influencerId);
    return this.csv.import({ ...dto, userId: user.id });
  }

  @ApiOperation({ summary: 'Crear prospecto manual' })
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProspectDto) {
    return this.prospects.create(user, dto);
  }

  @ApiOperation({
    summary: 'Backfill único: prospectos para leads ya APPROVED',
  })
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('backfill-approved-leads')
  backfill() {
    return this.ingestion.backfillApprovedLeads();
  }

  @ApiOperation({ summary: 'Detalle de prospecto' })
  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.prospects.findOne(user, id);
  }

  @ApiOperation({
    summary: 'Editar prospecto, sus campos personalizados o archivarlo',
  })
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProspectDto,
  ) {
    return this.prospects.update(user, id, dto);
  }
}
