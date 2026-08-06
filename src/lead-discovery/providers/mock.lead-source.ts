import type {
  LeadFindContext,
  LeadSourceOption,
  LeadSourceProvider,
  RawLeadContact,
} from '../interfaces/lead-source-provider.interface';

export class MockLeadSource implements LeadSourceProvider {
  readonly id = 'brightdata';

  isConfigured(): boolean {
    return true;
  }

  async listOptions(): Promise<LeadSourceOption[]> {
    // Mirrors production filter: only email/contact-oriented options
    return [
      {
        id: 'gd_me5ppxjr2ge6icjuh0',
        name: 'Mock LinkedIn people contact-enriched',
        kind: 'dataset',
      },
    ];
  }

  async findContacts(context: LeadFindContext): Promise<RawLeadContact[]> {
    const domain = context.domain || 'example.com';
    const base: RawLeadContact[] = [
      {
        contactName: 'Alex Rivera',
        title: 'Influencer Marketing Manager',
        email: `alex.rivera@${domain}`,
        profileUrl: 'https://linkedin.com/in/alex-rivera',
        fitReason: 'Mock influencer marketing contact',
        sourceOptionId: context.optionIds[0] ?? 'gd_me5ppxjr2ge6icjuh0',
        source: 'brightdata',
      },
      {
        contactName: 'Jordan Lee',
        title: 'CEO',
        email: `jordan.lee@${domain}`,
        fitReason: 'Mock CEO contact',
        sourceOptionId: context.optionIds[0] ?? 'gd_me5ppxjr2ge6icjuh0',
        source: 'brightdata',
      },
      {
        contactName: 'Sam Chen',
        title: 'Brand Partnerships',
        email: `sam.chen@${domain}`,
        fitReason: 'Mock partnerships contact',
        sourceOptionId: context.optionIds[0] ?? 'gd_me5ppxjr2ge6icjuh0',
        source: 'brightdata',
      },
      {
        contactName: 'Generic Desk',
        title: 'Info',
        email: `info@${domain}`,
        fitReason: 'Mock generic inbox',
        sourceOptionId: context.optionIds[0] ?? 'gd_me5ppxjr2ge6icjuh0',
        source: 'brightdata',
      },
    ];

    return base.slice(0, Math.max(context.limit, 1));
  }
}
