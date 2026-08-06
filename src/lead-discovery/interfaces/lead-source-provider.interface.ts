export type LeadSourceOption = {
  id: string;
  name: string;
  kind?: string;
};

export type LeadSourceOptionsResponse = {
  providerId: string;
  options: LeadSourceOption[];
};

export type RawLeadContact = {
  contactName: string;
  title?: string;
  email: string;
  profileUrl?: string;
  fitReason?: string;
  sourceOptionId?: string;
  source: string;
  metadata?: Record<string, unknown>;
};

export type LeadFindContext = {
  brandName: string;
  website: string;
  domain: string;
  limit: number;
  optionIds: string[];
  promptInstructions?: string;
};

export interface LeadSourceProvider {
  readonly id: string;
  isConfigured(): boolean;
  listOptions(): Promise<LeadSourceOption[]>;
  findContacts(context: LeadFindContext): Promise<RawLeadContact[]>;
}

export const LEAD_SOURCE_PROVIDER_TOKEN = Symbol('LEAD_SOURCE_PROVIDER');
