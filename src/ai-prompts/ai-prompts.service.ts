import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import { DEFAULT_IBP_INSTRUCTIONS } from '../ai/prompts/generate-ibp.prompt';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateIbpPromptTemplateDto } from './dto/update-ibp-prompt-template.dto';

export const IBP_PROMPT_TEMPLATE_ID = 'default';

export const ibpPromptTemplateSelect = {
  id: true,
  instructions: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AiPromptsService {
  constructor(private readonly prisma: PrismaService) {}

  async getIbpTemplate() {
    const template = await this.prisma.ibpPromptTemplate.findUnique({
      where: { id: IBP_PROMPT_TEMPLATE_ID },
      select: ibpPromptTemplateSelect,
    });

    if (!template) {
      return {
        id: IBP_PROMPT_TEMPLATE_ID,
        instructions: DEFAULT_IBP_INSTRUCTIONS,
        updatedById: null,
        createdAt: null,
        updatedAt: null,
        isDefault: true,
      };
    }

    return {
      ...template,
      isDefault: template.instructions === DEFAULT_IBP_INSTRUCTIONS,
    };
  }

  async getIbpInstructions(): Promise<string> {
    const template = await this.getIbpTemplate();
    return template.instructions.trim() || DEFAULT_IBP_INSTRUCTIONS;
  }

  async updateIbpTemplate(dto: UpdateIbpPromptTemplateDto, userId: string) {
    const instructions = dto.instructions.trim();

    const template = await this.prisma.ibpPromptTemplate.upsert({
      where: { id: IBP_PROMPT_TEMPLATE_ID },
      create: {
        id: IBP_PROMPT_TEMPLATE_ID,
        instructions,
        updatedById: userId,
      },
      update: {
        instructions,
        updatedById: userId,
      },
      select: ibpPromptTemplateSelect,
    });

    return {
      ...template,
      isDefault: template.instructions === DEFAULT_IBP_INSTRUCTIONS,
    };
  }

  async resetIbpTemplate(userId: string) {
    return this.updateIbpTemplate(
      { instructions: DEFAULT_IBP_INSTRUCTIONS },
      userId,
    );
  }

  static hashInstructions(instructions: string): string {
    return createHash('sha256').update(instructions).digest('hex').slice(0, 16);
  }
}
