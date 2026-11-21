import { AI_CONTRACT_VERSION } from '@influence-maven/ai-contracts';

import { runDiscoverAgencies } from './run-discover-agencies';

describe('runDiscoverAgencies (2C.2)', () => {
  it('classifies IMA hit as RELEVANT from searchHits', async () => {
    const result = await runDiscoverAgencies({
      operation: 'DISCOVER_AGENCIES',
      influencerId: '11111111-1111-4111-8111-111111111111',
      influencerName: 'Ana',
      searchHits: [
        {
          title: 'Bridge IMA',
          url: 'https://bridge.example/',
          content:
            'Influencer marketing agency that connects brands with creators',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.candidates[0]?.agency.agencyType).toBe(
      'INFLUENCER_MARKETING_AGENCY',
    );
    expect(result.output.candidates[0]?.association.relevanceStatus).toBe(
      'RELEVANT',
    );
  });

  it('returns NO_MATCHES when searchHits omitted', async () => {
    const result = await runDiscoverAgencies({
      operation: 'DISCOVER_AGENCIES',
      influencerId: '11111111-1111-4111-8111-111111111111',
      influencerName: 'Ana',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outcome).toBe('NO_MATCHES');
    expect(result.output.searchMetadata?.notes).toContain(
      'classifier_requires_searchHits',
    );
  });

  // Keep contract version import used (parity with other runners' env).
  it('shares AI contract version constant', () => {
    expect(AI_CONTRACT_VERSION).toBeTruthy();
  });
});
