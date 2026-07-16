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

const ibpPromptResponseSchema = {
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
    schema: ibpPromptResponseSchema,
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
    schema: ibpPromptResponseSchema,
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
    schema: ibpPromptResponseSchema,
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
}
