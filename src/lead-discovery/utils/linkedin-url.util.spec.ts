import {
  extractLinkedInSlug,
  normalizePeopleLinkedInUrl,
} from './linkedin-url.util';

describe('linkedin-url.util', () => {
  it('normalizes linkedin /in/ URLs', () => {
    expect(
      normalizePeopleLinkedInUrl(
        'https://www.linkedin.com/in/marianosaid?trk=foo',
      ),
    ).toBe('https://www.linkedin.com/in/marianosaid');
  });

  it('rejects linkedin company URLs', () => {
    expect(
      normalizePeopleLinkedInUrl('https://linkedin.com/company/liquid-iv'),
    ).toBeNull();
  });

  it('rejects linkedin posts', () => {
    expect(
      normalizePeopleLinkedInUrl(
        'https://linkedin.com/posts/marianosaid_activity',
      ),
    ).toBeNull();
  });

  it('extracts slug', () => {
    expect(
      extractLinkedInSlug('https://www.linkedin.com/in/colleen-finlon'),
    ).toBe('colleen-finlon');
  });
});
