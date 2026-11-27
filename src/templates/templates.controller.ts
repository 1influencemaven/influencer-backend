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
import {
  CreateTemplateDto,
  PreviewTemplateDto,
  QueryTemplatesDto,
  UpdateTemplateDto,
  ValidateTemplateDto,
} from './dto/templates.dto';
import { TemplatesService } from './templates.service';

/** Email templates per talent (HU-TPL-003..011). USER and ADMIN can manage them. */
@ApiTags('Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
@Controller({ path: 'templates', version: '1' })
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @ApiOperation({
    summary: 'Catálogo de variables agrupado por fuente (HU-TPL-008)',
  })
  @Get('variables')
  variables(@Query('locale') locale?: string) {
    return this.templates.catalog(locale === 'en' ? 'en' : 'es');
  }

  @ApiOperation({ summary: 'Plantillas que usan un campo (HU-TPL-002 CA-03)' })
  @Get('by-field/:fieldId')
  byField(@Param('fieldId') fieldId: string) {
    return this.templates.byField(fieldId);
  }

  @ApiOperation({
    summary: 'Listar plantillas (por talento o todas) (HU-TPL-004)',
  })
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: QueryTemplatesDto) {
    return this.templates.list(user, query);
  }

  @ApiOperation({ summary: 'Validar variables de un borrador (HU-TPL-009)' })
  @HttpCode(HttpStatus.OK)
  @Post('validate')
  validate(@Body() dto: ValidateTemplateDto) {
    return this.templates.validate(dto);
  }

  @ApiOperation({
    summary: 'Previsualizar con un prospecto sin guardar (HU-TPL-010/011)',
  })
  @HttpCode(HttpStatus.OK)
  @Post('preview')
  preview(@CurrentUser() user: AuthUser, @Body() dto: PreviewTemplateDto) {
    return this.templates.preview(user, dto);
  }

  @ApiOperation({ summary: 'Crear plantilla (HU-TPL-005)' })
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.templates.create(user, dto);
  }

  @ApiOperation({
    summary: 'Detalle con referencias y validación (HU-TPL-006)',
  })
  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.findOne(user, id);
  }

  @ApiOperation({
    summary: 'Contenido listo para un paso de secuencia en Saleshandy',
  })
  @Get(':id/saleshandy')
  exportForSaleshandy(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.exportForSaleshandy(user, id);
  }

  @ApiOperation({ summary: 'Editar plantilla (HU-TPL-006)' })
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(user, id, dto);
  }

  @ApiOperation({ summary: 'Archivar plantilla (HU-TPL-007)' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.setStatus(user, id, 'ARCHIVED');
  }

  @ApiOperation({ summary: 'Restaurar plantilla archivada' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.setStatus(user, id, 'ACTIVE');
  }
}
