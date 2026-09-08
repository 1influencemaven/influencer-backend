import {
  buildPublicEmailPageUrls,
  normalizeWebsiteBase,
} from './public-email-page-urls.util';

describe('public-email-page-urls.util', () => {
  it('normalizes website without scheme', () => {
    expect(normalizeWebsiteBase('liquid-iv.com')).toBe('https://liquid-iv.com');
  });

  it('rejects linkedin domains', () => {
    expect(normalizeWebsiteBase('https://linkedin.com/company/foo')).toBeNull();
  });

  it('builds deterministic allowlisted paths', () => {
    const urls = buildPublicEmailPageUrls('https://company.com', 6);
    expect(urls).toEqual([
      'https://company.com',
      'https://company.com/contact',
      'https://company.com/contact-us',
      'https://company.com/pages/contact',
      'https://company.com/about',
      'https://company.com/team',
    ]);
  });

  it('enforces MAX_EMAIL_DISCOVERY_PAGES', () => {
    const urls = buildPublicEmailPageUrls('https://company.com', 2);
    expect(urls).toHaveLength(2);
    expect(urls).toEqual(['https://company.com', 'https://company.com/contact']);
  });
});
