import {
  isAllowedBrandBusinessContactEmailDomain,
  isBrandDomainEmail,
  isFreeMailDomain,
} from './brand-business-contact-domain.util';

describe('brand-business-contact-domain', () => {
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

  it('allows brand domain and free-mail; rejects agency', () => {
    expect(
      isAllowedBrandBusinessContactEmailDomain('john@brand.com', 'brand.com'),
    ).toBe(true);
    expect(
      isAllowedBrandBusinessContactEmailDomain('john@gmail.com', 'brand.com'),
    ).toBe(true);
    expect(
      isAllowedBrandBusinessContactEmailDomain(
        'agency@agency.com',
        'brand.com',
      ),
    ).toBe(false);
  });
});
