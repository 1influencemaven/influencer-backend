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
  ApiBearerAuth,
  ApiCreatedResponse,
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
import {
  CreateFieldDto,
  QueryFieldsDto,
  UpdateFieldDto,
  UpdateFieldStatusDto,
} from './dto/fields.dto';
import { FieldsService } from './fields.service';

/**
 * Saleshandy prospect fields (HU-FLD-002..005). Everyone can read and sync;
 * only ADMIN changes the shared catalog (pending client confirmation).
 */
@ApiTags('Fields')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
@Controller({ path: 'fields', version: '1' })
export class FieldsController {
  constructor(private readonly fields: FieldsService) {}

  @ApiOperation({
    summary: 'Listar campos de sistema y personalizados (HU-FLD-002)',
  })
  @ApiOkResponse({ description: '{ data, counts, availableTags, lastSync }' })
  @Get()
  list(@Query() query: QueryFieldsDto) {
    return this.fields.list(query);
  }

  @ApiOperation({ summary: 'Historial de sincronizaciones (HU-FLD-005)' })
  @Get('sync/runs')
  syncRuns() {
    return this.fields.syncRuns();
  }

  @ApiOperation({ summary: 'Sincronizar con Saleshandy (HU-FLD-005)' })
  @HttpCode(HttpStatus.OK)
  @Post('sync')
  sync(@CurrentUser() user: AuthUser) {
    return this.fields.sync(user?.id);
  }

  @ApiOperation({ summary: 'Detalle de un campo' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fields.findOne(id);
  }

  @ApiOperation({ summary: 'Crear campo personalizado (HU-FLD-003)' })
  @ApiCreatedResponse()
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateFieldDto) {
    return this.fields.create(dto);
  }

  @ApiOperation({ summary: 'Actualizar campo personalizado (HU-FLD-004)' })
  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFieldDto) {
    return this.fields.update(id, dto);
  }

  @ApiOperation({
    summary: 'Habilitar o deshabilitar un campo personalizado (local)',
  })
  @Roles(Role.ADMIN)
  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: UpdateFieldStatusDto) {
    return this.fields.setStatus(id, dto.isActive);
  }
}
