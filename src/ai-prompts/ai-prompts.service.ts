import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import { DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS } from '../ai/prompts/generate-brand-discovery.prompt';
import { DEFAULT_IBP_INSTRUCTIONS } from '../ai/prompts/generate-ibp.prompt';
import { DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS } from '../ai/prompts/generate-lead-discovery.prompt';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateIbpPromptTemplateDto } from './dto/update-ibp-prompt-template.dto';

export const IBP_PROMPT_TEMPLATE_ID = 'default';
export const BRAND_DISCOVERY_PROMPT_TEMPLATE_ID = 'default';
export const LEAD_DISCOVERY_PROMPT_TEMPLATE_ID = 'default';

export const ibpPromptTemplateSelect = {
  id: true,
  instructions: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const brandDiscoveryPromptTemplateSelect = {
  id: true,
  instructions: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const leadDiscoveryPromptTemplateSelect = {
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

  async getBrandDiscoveryTemplate() {
    const template = await this.prisma.brandDiscoveryPromptTemplate.findUnique({
      where: { id: BRAND_DISCOVERY_PROMPT_TEMPLATE_ID },
      select: brandDiscoveryPromptTemplateSelect,
    });

    if (!template) {
      return {
        id: BRAND_DISCOVERY_PROMPT_TEMPLATE_ID,
        instructions: DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS,
        updatedById: null,
        createdAt: null,
        updatedAt: null,
        isDefault: true,
      };
    }

    return {
      ...template,
      isDefault:
        template.instructions === DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS,
    };
  }

  async getBrandDiscoveryInstructions(): Promise<string> {
    const template = await this.getBrandDiscoveryTemplate();
    return (
      template.instructions.trim() || DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS
    );
  }

  async updateBrandDiscoveryTemplate(
    dto: UpdateIbpPromptTemplateDto,
    userId: string,
  ) {
    const instructions = dto.instructions.trim();

    const template = await this.prisma.brandDiscoveryPromptTemplate.upsert({
      where: { id: BRAND_DISCOVERY_PROMPT_TEMPLATE_ID },
      create: {
        id: BRAND_DISCOVERY_PROMPT_TEMPLATE_ID,
        instructions,
        updatedById: userId,
      },
      update: {
        instructions,
        updatedById: userId,
      },
      select: brandDiscoveryPromptTemplateSelect,
    });

    return {
      ...template,
      isDefault:
        template.instructions === DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS,
    };
  }

  async resetBrandDiscoveryTemplate(userId: string) {
    return this.updateBrandDiscoveryTemplate(
      { instructions: DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS },
      userId,
    );
  }

  async getLeadDiscoveryTemplate() {
    const template = await this.prisma.leadDiscoveryPromptTemplate.findUnique({
      where: { id: LEAD_DISCOVERY_PROMPT_TEMPLATE_ID },
      select: leadDiscoveryPromptTemplateSelect,
    });

    if (!template) {
      return {
        id: LEAD_DISCOVERY_PROMPT_TEMPLATE_ID,
        instructions: DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS,
        updatedById: null,
        createdAt: null,
        updatedAt: null,
        isDefault: true,
      };
    }

    return {
      ...template,
      isDefault: template.instructions === DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS,
    };
  }

  async getLeadDiscoveryInstructions(): Promise<string> {
    const template = await this.getLeadDiscoveryTemplate();
    return template.instructions.trim() || DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS;
  }

  async updateLeadDiscoveryTemplate(
    dto: UpdateIbpPromptTemplateDto,
    userId: string,
  ) {
    const instructions = dto.instructions.trim();

    const template = await this.prisma.leadDiscoveryPromptTemplate.upsert({
      where: { id: LEAD_DISCOVERY_PROMPT_TEMPLATE_ID },
      create: {
        id: LEAD_DISCOVERY_PROMPT_TEMPLATE_ID,
        instructions,
        updatedById: userId,
      },
      update: {
        instructions,
        updatedById: userId,
      },
      select: leadDiscoveryPromptTemplateSelect,
    });

    return {
      ...template,
      isDefault: template.instructions === DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS,
    };
  }

  async resetLeadDiscoveryTemplate(userId: string) {
    return this.updateLeadDiscoveryTemplate(
      { instructions: DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS },
      userId,
    );
  }

  static hashInstructions(instructions: string): string {
    return createHash('sha256').update(instructions).digest('hex').slice(0, 16);
  }
}
