import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { Role } from '../generated/prisma/enums';
import { AiPromptsService } from './ai-prompts.service';
import { UpdateIbpPromptTemplateDto } from './dto/update-ibp-prompt-template.dto';

const promptTemplateResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'default' },
    instructions: {
      type: 'string',
      example: 'You are a commercial strategist...',
    },
    updatedById: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time', nullable: true },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
    isDefault: { type: 'boolean', example: true },
  },
};

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({
  path: 'settings',
  version: '1',
})
export class AiPromptsController {
  constructor(private readonly aiPromptsService: AiPromptsService) {}

  @ApiOperation({
    summary: 'Obtener prompt IBP',
    description:
      'Devuelve las instrucciones de negocio usadas para generar perfiles ideales.',
  })
  @ApiOkResponse({
    description: 'Template de prompt IBP',
    schema: promptTemplateResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Roles(Role.USER, Role.ADMIN)
  @Get('ibp-prompt')
  getIbpPrompt() {
    return this.aiPromptsService.getIbpTemplate();
  }

  @ApiOperation({
    summary: 'Actualizar prompt IBP',
    description:
      'Actualiza las instrucciones de negocio del prompt IBP. Solo ADMIN.',
  })
  @ApiBody({ type: UpdateIbpPromptTemplateDto })
  @ApiOkResponse({
    description: 'Template actualizado',
    schema: promptTemplateResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Solo ADMIN puede editar' })
  @Roles(Role.ADMIN)
  @Patch('ibp-prompt')
  updateIbpPrompt(
    @Body() dto: UpdateIbpPromptTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.aiPromptsService.updateIbpTemplate(dto, user.id);
  }

  @ApiOperation({
    summary: 'Restaurar prompt IBP predeterminado',
    description:
      'Restaura las instrucciones por defecto del sistema. Solo ADMIN.',
  })
  @ApiOkResponse({
    description: 'Template restaurado al valor por defecto',
    schema: promptTemplateResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Solo ADMIN puede restaurar' })
  @Roles(Role.ADMIN)
  @Post('ibp-prompt/reset')
  resetIbpPrompt(@CurrentUser() user: AuthUser) {
    return this.aiPromptsService.resetIbpTemplate(user.id);
  }

  @ApiOperation({
    summary: 'Obtener prompt Brand Discovery',
    description:
      'Devuelve las instrucciones de negocio usadas al buscar y puntuar marcas candidatas.',
  })
  @ApiOkResponse({
    description: 'Template de prompt Brand Discovery',
    schema: promptTemplateResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Roles(Role.USER, Role.ADMIN)
  @Get('brand-discovery-prompt')
  getBrandDiscoveryPrompt() {
    return this.aiPromptsService.getBrandDiscoveryTemplate();
  }

  @ApiOperation({
    summary: 'Actualizar prompt Brand Discovery',
    description:
      'Actualiza las instrucciones de negocio del prompt de búsqueda de marcas. Solo ADMIN.',
  })
  @ApiBody({ type: UpdateIbpPromptTemplateDto })
  @ApiOkResponse({
    description: 'Template actualizado',
    schema: promptTemplateResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Solo ADMIN puede editar' })
  @Roles(Role.ADMIN)
  @Patch('brand-discovery-prompt')
  updateBrandDiscoveryPrompt(
    @Body() dto: UpdateIbpPromptTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.aiPromptsService.updateBrandDiscoveryTemplate(dto, user.id);
  }

  @ApiOperation({
    summary: 'Restaurar prompt Brand Discovery predeterminado',
    description:
      'Restaura las instrucciones por defecto del sistema. Solo ADMIN.',
  })
  @ApiOkResponse({
    description: 'Template restaurado al valor por defecto',
    schema: promptTemplateResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Solo ADMIN puede restaurar' })
  @Roles(Role.ADMIN)
  @Post('brand-discovery-prompt/reset')
  resetBrandDiscoveryPrompt(@CurrentUser() user: AuthUser) {
    return this.aiPromptsService.resetBrandDiscoveryTemplate(user.id);
  }

  @ApiOperation({
    summary: 'Obtener prompt Lead Discovery',
    description:
      'Devuelve las instrucciones de negocio usadas al planificar la búsqueda de contactos.',
  })
  @ApiOkResponse({
    description: 'Template de prompt Lead Discovery',
    schema: promptTemplateResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Permisos insuficientes' })
  @Roles(Role.USER, Role.ADMIN)
  @Get('lead-discovery-prompt')
  getLeadDiscoveryPrompt() {
    return this.aiPromptsService.getLeadDiscoveryTemplate();
  }

  @ApiOperation({
    summary: 'Actualizar prompt Lead Discovery',
    description:
      'Actualiza las instrucciones de negocio del prompt de contactos. Solo ADMIN.',
  })
  @ApiBody({ type: UpdateIbpPromptTemplateDto })
  @ApiOkResponse({
    description: 'Template actualizado',
    schema: promptTemplateResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Solo ADMIN puede editar' })
  @Roles(Role.ADMIN)
  @Patch('lead-discovery-prompt')
  updateLeadDiscoveryPrompt(
    @Body() dto: UpdateIbpPromptTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.aiPromptsService.updateLeadDiscoveryTemplate(dto, user.id);
  }

  @ApiOperation({
    summary: 'Restaurar prompt Lead Discovery predeterminado',
    description:
      'Restaura las instrucciones por defecto del sistema. Solo ADMIN.',
  })
  @ApiOkResponse({
    description: 'Template restaurado al valor por defecto',
    schema: promptTemplateResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Token de acceso inválido o ausente',
  })
  @ApiForbiddenResponse({ description: 'Solo ADMIN puede restaurar' })
  @Roles(Role.ADMIN)
  @Post('lead-discovery-prompt/reset')
  resetLeadDiscoveryPrompt(@CurrentUser() user: AuthUser) {
    return this.aiPromptsService.resetLeadDiscoveryTemplate(user.id);
  }
}
