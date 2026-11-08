import { ContactResearchToolSession } from './session';

describe('ContactResearchToolSession', () => {
  it('allows brand host and subdomains only', () => {
    const session = new ContactResearchToolSession({
      brandName: 'Brand',
      website: 'https://www.brand.com',
      domain: 'brand.com',
      maxSerpQueries: 3,
      maxPages: 3,
    });
    expect(session.isAllowedUrl('https://brand.com/contact')).toBe(true);
    expect(session.isAllowedUrl('https://www.brand.com/press')).toBe(true);
    expect(session.isAllowedUrl('https://shop.brand.com/')).toBe(true);
    expect(session.isAllowedUrl('https://evil.com/')).toBe(false);
    expect(session.isAllowedUrl('not-a-url')).toBe(false);
  });
});
