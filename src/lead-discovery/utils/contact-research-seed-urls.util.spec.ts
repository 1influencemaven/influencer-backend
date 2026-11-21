import { sanitizeContactResearchSeedUrls } from './contact-research-seed-urls.util';

describe('sanitizeContactResearchSeedUrls (RF-02.1)', () => {
  it('keeps valid http(s) URLs and caps length', () => {
    expect(
      sanitizeContactResearchSeedUrls(
        [
          'https://brand.com/press',
          'http://brand.com/partnerships',
          'https://brand.com/press',
          'https://brand.com/press/',
        ],
        12,
      ),
    ).toEqual([
      'https://brand.com/press',
      'http://brand.com/partnerships',
    ]);
  });

  it('drops empty, malformed, and non-http protocols without throwing', () => {
    expect(
      sanitizeContactResearchSeedUrls([
        '',
        '   ',
        'not-a-url',
        '/relative',
        'ftp://brand.com/x',
        'javascript:alert(1)',
        null,
        123,
        'https://brand.com/ok',
      ]),
    ).toEqual(['https://brand.com/ok']);
  });

  it('returns empty array for non-array input', () => {
    expect(sanitizeContactResearchSeedUrls(undefined)).toEqual([]);
    expect(sanitizeContactResearchSeedUrls('https://x.com')).toEqual([]);
  });
});
