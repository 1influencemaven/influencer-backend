import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { Role } from '../generated/prisma/enums';
import { SaleshandyHttpService } from '../integrations/saleshandy/saleshandy-http.service';
import {
  BulkConnectEmailAccountsDto,
  EmailAccountConnectionDto,
} from './dto/connect-email-account.dto';
import {
  BulkUpdateEmailAccountsDto,
  ReconnectEmailAccountsDto,
} from './dto/email-account-actions.dto';
import { QueryEmailAccountsDto } from './dto/query-email-accounts.dto';
import { EmailAccountsService } from './email-accounts.service';

/**
 * Email Accounts (Saleshandy sender mailboxes). USER and ADMIN can read and
 * manage them; the integration diagnostic is ADMIN only.
 */
@ApiTags('Email Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
@Controller({ path: 'email-accounts', version: '1' })
export class EmailAccountsController {
  constructor(
    private readonly emailAccounts: EmailAccountsService,
    private readonly saleshandy: SaleshandyHttpService,
  ) {}

  @ApiOperation({ summary: 'Listar cuentas de correo (HU-EA-001)' })
  @ApiOkResponse({ description: '{ data, meta, counts }' })
  @Get()
  list(@Query() query: QueryEmailAccountsDto) {
    return this.emailAccounts.list(query);
  }

  @ApiOperation({ summary: 'Secuencias y clientes de Saleshandy (filtros y selectores)' })
  @Get('options')
  options() {
    return this.emailAccounts.options();
  }

  @ApiOperation({ summary: 'Estado de la integración con Saleshandy (HU-EA-000 CA-07)' })
  @Roles(Role.ADMIN)
  @Get('integration/status')
  integrationStatus() {
    return this.saleshandy.checkConnectivity();
  }

  @ApiOperation({ summary: 'Conectar una cuenta SMTP/IMAP (HU-EA-006)' })
  @HttpCode(HttpStatus.OK)
  @Post('smtp-imap/connect')
  connectSingle(@Body() dto: EmailAccountConnectionDto) {
    return this.emailAccounts.connectSingle(dto);
  }

  @ApiOperation({ summary: 'Conectar varias cuentas (asíncrono, HU-EA-002)' })
  @ApiAcceptedResponse({ description: 'Job con requestId' })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('connect')
  connectBulk(
    @Body() dto: BulkConnectEmailAccountsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.emailAccounts.connectBulk(dto.accounts, user?.id ?? null);
  }

  @ApiOperation({ summary: 'Reconectar cuentas (asíncrono, HU-EA-003)' })
  @ApiAcceptedResponse({ description: 'Job con requestId' })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('reconnect')
  reconnect(
    @Body() dto: ReconnectEmailAccountsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.emailAccounts.reconnect(dto.emailAccountIds, user?.id ?? null);
  }

  @ApiOperation({ summary: 'Procesos de conexión/reconexión recientes (HU-EA-004)' })
  @Get('jobs')
  listJobs() {
    return this.emailAccounts.listJobs();
  }

  @ApiOperation({ summary: 'Estado de un proceso (id o requestId) (HU-EA-004)' })
  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.emailAccounts.getJob(id);
  }

  @ApiOperation({ summary: 'Actualizar configuración en bloque (HU-EA-005)' })
  @HttpCode(HttpStatus.OK)
  @Post('bulk-update')
  bulkUpdate(@Body() dto: BulkUpdateEmailAccountsDto) {
    return this.emailAccounts.bulkUpdate(dto);
  }
}
