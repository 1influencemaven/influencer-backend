import { CommercialRelevance } from '../generated/prisma/enums';

import { BrandBusinessContactDiscoveryService } from './brand-business-contact-discovery.service';

describe('BrandBusinessContactDiscoveryService', () => {
  const unlocker = {
    fetchRawHtml: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'MAX_BRAND_BUSINESS_CONTACT_PAGES') return 12;
      if (key === 'MAX_BRAND_BUSINESS_CONTACTS') return 15;
      return undefined;
    }),
  };

  let service: BrandBusinessContactDiscoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BrandBusinessContactDiscoveryService(
      unlocker as never,
      configService as never,
    );
  });

  function htmlWith(...emails: string[]) {
    return {
      html: `<p>Reach us at ${emails.join(' or ')} for partnerships</p>`,
      httpStatus: 200,
      elapsedMs: 1,
      emptyBody: false,
    };
  }

  it('persists HIGH and UNKNOWN including personal-looking and free-mail', async () => {
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        return htmlWith(
          'partnerships@brand.com',
          'john@brand.com',
          'john@gmail.com',
        );
      }
      return { html: '', httpStatus: 404, elapsedMs: 1, emptyBody: true };
    });

    const result = await service.discover({
      brandCandidateId: 'b1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    const emails = result.candidates.map((c) => c.emailNormalized).sort();
    expect(emails).toEqual([
      'john@brand.com',
      'john@gmail.com',
      'partnerships@brand.com',
    ]);
    expect(
      result.candidates.find((c) => c.emailNormalized === 'partnerships@brand.com')
        ?.commercialRelevance,
    ).toBe(CommercialRelevance.HIGH);
    expect(
      result.candidates.find((c) => c.emailNormalized === 'john@brand.com')
        ?.commercialRelevance,
    ).toBe(CommercialRelevance.UNKNOWN);
  });

  it('discards LOW and agency domains', async () => {
    unlocker.fetchRawHtml.mockImplementation(async (url: string) => {
      if (url.endsWith('/partnerships')) {
        return htmlWith(
          'support@brand.com',
          'noreply@brand.com',
          'agency@agency.com',
          'influencer@brand.com',
        );
      }
      return { html: '', httpStatus: 404, elapsedMs: 1, emptyBody: true };
    });

    const result = await service.discover({
      brandCandidateId: 'b1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(result.candidates.map((c) => c.emailNormalized)).toEqual([
      'influencer@brand.com',
    ]);
  });

  it('skips invalid website without throwing', async () => {
    const result = await service.discover({
      brandCandidateId: 'b1',
      website: '',
      domain: 'brand.com',
    });
    expect(result.candidates).toEqual([]);
    expect(unlocker.fetchRawHtml).not.toHaveBeenCalled();
  });

  it('counts page failures without aborting', async () => {
    unlocker.fetchRawHtml.mockResolvedValue({
      html: '',
      httpStatus: 500,
      elapsedMs: 1,
      emptyBody: true,
    });

    const result = await service.discover({
      brandCandidateId: 'b1',
      website: 'https://brand.com',
      domain: 'brand.com',
    });

    expect(result.summary.pagesAttempted).toBe(12);
    expect(result.summary.pagesFailed).toBe(12);
    expect(result.summary.pagesSucceeded).toBe(0);
    expect(result.candidates).toEqual([]);
  });
});
