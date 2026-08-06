import type {
  LeadFindContext,
  LeadSourceOption,
  LeadSourceProvider,
  RawLeadContact,
} from '../interfaces/lead-source-provider.interface';
import { AI_BRIGHTDATA_PROVIDER_ID } from './ai-plus-brightdata.lead-source';

export class MockAiPlusBrightDataLeadSource implements LeadSourceProvider {
  readonly id = AI_BRIGHTDATA_PROVIDER_ID;

  isConfigured(): boolean {
    return true;
  }

  async listOptions(): Promise<LeadSourceOption[]> {
    return [
      {
        id: 'autonomous',
        name: 'Autonomous AI + Bright Data (mock)',
        kind: 'autonomous',
      },
    ];
  }

  async findContacts(context: LeadFindContext): Promise<RawLeadContact[]> {
    const domain = context.domain || 'example.com';
    return [
      {
        contactName: 'Alex Rivera',
        title: 'Influencer Marketing Manager',
        email: `alex.rivera@${domain}`,
        profileUrl: 'https://linkedin.com/in/alex-rivera',
        fitReason: 'Mock autonomous lead',
        sourceOptionId: 'autonomous',
        source: AI_BRIGHTDATA_PROVIDER_ID,
      },
      {
        contactName: 'Jordan Lee',
        title: 'CEO',
        email: `jordan.lee@${domain}`,
        fitReason: 'Mock autonomous lead',
        sourceOptionId: 'autonomous',
        source: AI_BRIGHTDATA_PROVIDER_ID,
      },
    ].slice(0, Math.max(context.limit, 1));
  }
}
