jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AgencyDiscoveryService } from './agency-discovery.service';
import type { AgencyPersistenceService } from './agency-persistence.service';
import type { BrightDataWebSearchProvider } from '../brand-discovery/providers/brightdata-web-search.provider';
import { BrightDataSerpProviderError } from '../integrations/brightdata';

describe('AgencyDiscoveryService (2C.2)', () => {
  const influencerId = '11111111-1111-4111-8111-111111111111';

  function buildService(searchImpl: BrightDataWebSearchProvider['search']) {
    const webSearch = {
      name: 'brightdata',
      search: jest.fn(searchImpl),
    } as unknown as BrightDataWebSearchProvider;
    const persistence = {
      upsertCandidate: jest.fn().mockResolvedValue({
        agencyId: 'a1',
        associationId: 'ia1',
        agencyCreated: true,
        associationCreated: true,
        domain: 'x.example',
      }),
    } as unknown as AgencyPersistenceService;
    return {
      service: new AgencyDiscoveryService(webSearch, persistence),
      webSearch,
      persistence,
    };
  }

  it('runs SERP within query budget and classifies + persists', async () => {
    const { service, webSearch, persistence } = buildService(async () => [
      {
        title: 'Glow — Influencer Marketing Agency',
        url: 'https://glow.example/',
        content: 'Influencer marketing agency connecting brands with creators',
      },
      {
        title: 'Top 10 Agencies',
        url: 'https://clutch.co/agencies/list',
        content: 'Best influencer marketing agencies roundup',
      },
    ]);

    const result = await service.execute({
      operation: 'DISCOVER_AGENCIES',
      influencerId,
      influencerName: 'Ana Fit',
      niche: 'beauty',
      country: 'US',
      maxSerpQueries: 2,
    });

    expect(webSearch.search).toHaveBeenCalled();
    expect((webSearch.search as jest.Mock).mock.calls.length).toBeLessThanOrEqual(2);
    expect(result.queries.length).toBe(2);
    expect(result.output.operation).toBe('DISCOVER_AGENCIES');
    expect(result.output.candidates.length).toBeGreaterThan(0);
    expect(result.output.searchMetadata?.serpCalls).toBe(2);
    expect(persistence.upsertCandidate).toHaveBeenCalled();
  });

  it('classifies pre-fetched searchHits without SERP calls', async () => {
    const { service, webSearch, persistence } = buildService(async () => {
      throw new Error('should not SERP');
    });

    const result = await service.execute(
      {
        operation: 'DISCOVER_AGENCIES',
        influencerId,
        influencerName: 'Ana Fit',
        searchHits: [
          {
            title: 'Partnerly IMA',
            url: 'https://partnerly.example/',
            content:
              'We manage influencer campaigns for brands and connect brands with influencers',
          },
        ],
      },
      { persist: false },
    );

    expect(webSearch.search).not.toHaveBeenCalled();
    expect(persistence.upsertCandidate).not.toHaveBeenCalled();
    expect(result.output.candidates[0]?.agency.agencyType).toBe(
      'INFLUENCER_MARKETING_AGENCY',
    );
    expect(result.output.outcome).toBe('RESULTS_FOUND');
  });

  it('returns PROVIDER_FAILURE when all SERP calls fail and no hits', async () => {
    const { service } = buildService(async () => {
      throw new BrightDataSerpProviderError('down', {
        resultCategory: 'network_error',
        httpStatus: 0,
      });
    });

    const result = await service.execute({
      operation: 'DISCOVER_AGENCIES',
      influencerId,
      influencerName: 'Ana Fit',
      niche: 'fitness',
      maxSerpQueries: 2,
    });

    expect(result.output.outcome).toBe('PROVIDER_FAILURE');
    expect(result.output.searchMetadata?.providerErrors?.length).toBeGreaterThan(
      0,
    );
  });
});
