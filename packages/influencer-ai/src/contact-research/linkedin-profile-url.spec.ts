import {
  collectLinkedInPeopleUrls,
  normalizeLinkedInPeopleUrl,
} from './linkedin-profile-url';

describe('normalizeLinkedInPeopleUrl', () => {
  it('accepts /in/ profile URLs', () => {
    expect(
      normalizeLinkedInPeopleUrl(
        'https://www.linkedin.com/in/alex-partner?trk=x',
      ),
    ).toMatch(/linkedin\.com\/in\//i);
  });

  it('rejects company URLs', () => {
    expect(
      normalizeLinkedInPeopleUrl('https://www.linkedin.com/company/acme'),
    ).toBeNull();
  });
});

describe('collectLinkedInPeopleUrls', () => {
  it('dedupes and caps', () => {
    const urls = collectLinkedInPeopleUrls(
      [
        'https://www.linkedin.com/in/alex',
        'https://linkedin.com/in/alex/',
        'https://www.linkedin.com/in/sam',
        'https://example.com/x',
      ],
      2,
    );
    expect(urls).toHaveLength(2);
  });
});
