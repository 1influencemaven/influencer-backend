import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../generated/prisma/enums';
import { BrandKnowledgeService } from './brand-knowledge.service';

@ApiTags('Brand Knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller({ path: 'brand-knowledge', version: '1' })
export class BrandKnowledgeController {
  constructor(private readonly brandKnowledgeService: BrandKnowledgeService) {}

  @ApiOperation({
    summary: 'Reconstruir la base de conocimiento de marcas',
    description:
      'Recalcula marcas y afinidades por nicho desde los BrandCandidate existentes. Idempotente: ejecutarlo dos veces produce los mismos datos.',
  })
  @ApiOkResponse({ description: 'Resumen de la reconstrucción' })
  @ApiUnauthorizedResponse({ description: 'No autenticado' })
  @ApiForbiddenResponse({ description: 'Solo ADMIN' })
  @Post('rebuild')
  @HttpCode(HttpStatus.OK)
  rebuild() {
    return this.brandKnowledgeService.rebuildFromCandidates();
  }
}
