import { ConfigService } from '@nestjs/config';

import { BrightDataClient } from '../clients/brightdata.client';
import { BrightDataSearchClient } from '../clients/brightdata-search.client';
import { PublicEmailEvidenceDiscoveryService } from './public-email-evidence-discovery.service';

function mockConfig(
  overrides: Record<string, number> = {},
): ConfigService {
  const values: Record<string, number> = {
    MAX_EMAIL_DISCOVERY_PAGES: 6,
    MAX_EMAIL_CANDIDATES: 20,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('PublicEmailEvidenceDiscoveryService', () => {
  let unlocker: { fetchRawHtml: jest.Mock };
  let brightDataClient: { triggerAndCollect: jest.Mock };
  let service: PublicEmailEvidenceDiscoveryService;

  beforeEach(() => {
    unlocker = { fetchRawHtml: jest.fn() };
    brightDataClient = { triggerAndCollect: jest.fn() };
    service = new PublicEmailEvidenceDiscoveryService(
      unlocker as unknown as BrightDataSearchClient,
      brightDataClient as unknown as BrightDataClient,
      mockConfig(),
    );
  });

  const baseInput = {
    personName: 'Mariano Said',
    profileUrl: 'https://www.linkedin.com/in/marianosaid',
    companyName: 'Liquid I.V.',
    companyWebsite: 'https://liquid-iv.com',
  };

  it('preserves sourceUrl and evidenceSnippet on candidates', async () => {
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => ({
      html:
        url.endsWith('/contact') ?
          '<p>partnerships@liquid-iv.com</p>'
        : '',
      httpStatus: url.endsWith('/contact') ? 200 : 404,
      elapsedMs: 10,
      emptyBody: !url.endsWith('/contact'),
    }));

    const result = await service.discoverForProfile(baseInput);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].email).toBe('partnerships@liquid-iv.com');
    expect(result.candidates[0].evidences[0].sourceUrl).toBe(
      'https://liquid-iv.com/contact',
    );
    expect(result.candidates[0].evidences[0].evidenceSnippet).toContain(
      'partnerships@liquid-iv.com',
    );
    expect(result.candidates[0].evidences[0].sourceType).toBe('public-web');
  });

  it('deduplicates the same email across pages with multiple evidences', async () => {
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => ({
      html: '<span>info@company.com</span>',
      httpStatus: 200,
      elapsedMs: 5,
      emptyBody: false,
    }));

    const result = await service.discoverForProfile({
      ...baseInput,
      companyWebsite: 'https://company.com',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].evidences.length).toBeGreaterThan(1);
  });

  it('continues when one page fails and others succeed', async () => {
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/contact')) {
        return {
          html: '',
          httpStatus: 500,
          elapsedMs: 8,
          emptyBody: true,
        };
      }
      if (url.endsWith('/about')) {
        return {
          html: 'marketing@company.com',
          httpStatus: 200,
          elapsedMs: 12,
          emptyBody: false,
        };
      }
      return {
        html: '',
        httpStatus: 404,
        elapsedMs: 5,
        emptyBody: true,
      };
    });

    const result = await service.discoverForProfile({
      ...baseInput,
      companyWebsite: 'https://company.com',
    });

    expect(result.summary.pagesAttempted).toBeGreaterThan(1);
    expect(result.summary.pagesSucceeded).toBeGreaterThanOrEqual(1);
    expect(result.candidates.some((c) => c.email === 'marketing@company.com'))
      .toBe(true);
    expect(result.summary.errors).toBeGreaterThan(0);
  });

  it('handles unlocker network errors per page', async () => {
    unlocker.fetchRawHtml.mockResolvedValue({
      html: '',
      httpStatus: 0,
      elapsedMs: 1,
      emptyBody: true,
    });

    const result = await service.discoverForProfile(baseInput);
    expect(result.candidates).toHaveLength(0);
    expect(result.summary.errors).toBeGreaterThan(0);
  });

  it('enforces MAX_EMAIL_CANDIDATES', async () => {
    service = new PublicEmailEvidenceDiscoveryService(
      unlocker as unknown as BrightDataSearchClient,
      brightDataClient as unknown as BrightDataClient,
      mockConfig({ MAX_EMAIL_CANDIDATES: 2 }),
    );

    unlocker.fetchRawHtml.mockResolvedValue({
      html: 'a@company.com b@company.com c@company.com',
      httpStatus: 200,
      elapsedMs: 5,
      emptyBody: false,
    });

    const result = await service.discoverForProfile({
      ...baseInput,
      companyWebsite: 'https://company.com',
    });
    expect(result.candidates.length).toBeLessThanOrEqual(2);
  });

  it('enforces MAX_EMAIL_DISCOVERY_PAGES', async () => {
    service = new PublicEmailEvidenceDiscoveryService(
      unlocker as unknown as BrightDataSearchClient,
      brightDataClient as unknown as BrightDataClient,
      mockConfig({ MAX_EMAIL_DISCOVERY_PAGES: 2 }),
    );

    unlocker.fetchRawHtml.mockResolvedValue({
      html: 'info@company.com',
      httpStatus: 200,
      elapsedMs: 3,
      emptyBody: false,
    });

    const result = await service.discoverForProfile({
      ...baseInput,
      companyWebsite: 'https://company.com',
    });
    expect(result.summary.pagesAttempted).toBe(2);
    expect(unlocker.fetchRawHtml).toHaveBeenCalledTimes(2);
  });

  it('resolves company website via LinkedIn company scraper when missing', async () => {
    brightDataClient.triggerAndCollect.mockResolvedValue([
      { website: 'https://company.com' },
    ]);
    unlocker.fetchRawHtml.mockResolvedValue({
      html: 'contact@company.com',
      httpStatus: 200,
      elapsedMs: 4,
      emptyBody: false,
    });

    const result = await service.discoverForProfile({
      personName: 'Test User',
      profileUrl: 'https://linkedin.com/in/test',
      companyName: 'Company',
      companyLinkedInUrl: 'https://linkedin.com/company/company',
    });

    expect(brightDataClient.triggerAndCollect).toHaveBeenCalled();
    expect(result.summary.website).toBe('https://company.com');
    expect(result.candidates[0].email).toBe('contact@company.com');
  });

  it('marks generic emails with isGeneric true', async () => {
    unlocker.fetchRawHtml.mockResolvedValue({
      html: 'info@company.com and john.smith@company.com',
      httpStatus: 200,
      elapsedMs: 4,
      emptyBody: false,
    });

    const result = await service.discoverForProfile({
      ...baseInput,
      companyWebsite: 'https://company.com',
    });

    const info = result.candidates.find((c) => c.email === 'info@company.com');
    const personal = result.candidates.find(
      (c) => c.email === 'john.smith@company.com',
    );
    expect(info?.isGeneric).toBe(true);
    expect(personal?.isGeneric).toBe(false);
  });
});
