import {
  assessBrandBusinessContactEmailDomain,
  buildCorroboratedBrandDomains,
  isAllowedBrandBusinessContactEmailDomain,
  isBrandDomainEmail,
  isFreeMailDomain,
} from './brand-business-contact-domain.util';

describe('brand-business-contact-domain (RF-01)', () => {
  it('accepts brand domain and subdomain', () => {
    expect(isBrandDomainEmail('john@brand.com', 'brand.com')).toBe(true);
    expect(isBrandDomainEmail('a@mail.brand.com', 'brand.com')).toBe(true);
    expect(isBrandDomainEmail('a@agency.com', 'brand.com')).toBe(false);
  });

  it('detects free-mail', () => {
    expect(isFreeMailDomain('john@gmail.com')).toBe(true);
    expect(isFreeMailDomain('john@yahoo.com')).toBe(true);
    expect(isFreeMailDomain('a@brand.com')).toBe(false);
  });

  it('allows official brand domain emails (case 1)', () => {
    expect(
      isAllowedBrandBusinessContactEmailDomain(
        'partnerships@brand.com',
        'brand.com',
      ),
    ).toBe(true);
    expect(
      assessBrandBusinessContactEmailDomain(
        'info@brand.com',
        'brand.com',
      ).reason,
    ).toBe('brand_domain');
  });

  it('allows corroborated alternate corporate domains (case 2)', () => {
    expect(
      isAllowedBrandBusinessContactEmailDomain(
        'hello@brand-eu.com',
        'brand.com',
        ['brand-eu.com'],
      ),
    ).toBe(true);
    expect(
      assessBrandBusinessContactEmailDomain('hello@brand-eu.com', 'brand.com', [
        'brand-eu.com',
      ]).reason,
    ).toBe('corroborated_domain');
  });

  it('rejects uncorroborated third-party / agency domains (case 3)', () => {
    expect(
      isAllowedBrandBusinessContactEmailDomain(
        'agency@agency.com',
        'brand.com',
      ),
    ).toBe(false);
    expect(
      assessBrandBusinessContactEmailDomain('agency@agency.com', 'brand.com')
        .reason,
    ).toBe('external_domain');
  });

  it('rejects free-mail as brand business contact (no ownership claim)', () => {
    expect(
      isAllowedBrandBusinessContactEmailDomain('john@gmail.com', 'brand.com'),
    ).toBe(false);
    expect(
      assessBrandBusinessContactEmailDomain('john@gmail.com', 'brand.com')
        .reason,
    ).toBe('free_mail');
  });

  it('rejects noreply local-parts (case 7)', () => {
    expect(
      isAllowedBrandBusinessContactEmailDomain(
        'noreply@brand.com',
        'brand.com',
      ),
    ).toBe(false);
    expect(
      assessBrandBusinessContactEmailDomain('noreply@brand.com', 'brand.com')
        .reason,
    ).toBe('blocked_local');
  });

  it('buildCorroboratedBrandDomains merges website host without duplicates', () => {
    expect(
      buildCorroboratedBrandDomains({
        brandDomain: 'brand.com',
        website: 'https://www.brand.com/contact',
        additionalDomains: ['brand-eu.com', 'https://brand.com'],
      }),
    ).toEqual(['brand.com', 'brand-eu.com']);
  });
});
