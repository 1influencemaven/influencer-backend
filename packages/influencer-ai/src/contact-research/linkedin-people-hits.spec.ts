import {
  brandMatchKeys,
  profileBelongsToBrand,
  roleFromSerpTitle,
  selectLinkedInPeopleHits,
} from './linkedin-people-hits';

const hit = (url: string, title: string, snippet = '') => ({
  url,
  title,
  snippet,
});

describe('selectLinkedInPeopleHits', () => {
  it('keeps only profiles whose SERP title/snippet names the brand, role matches first', () => {
    const selected = selectLinkedInPeopleHits(
      [
        hit(
          'https://ca.linkedin.com/in/audreyackerman',
          'Audrey Ackerman - Designer | LinkedIn',
          'Toronto',
        ),
        hit(
          'https://www.linkedin.com/in/jane',
          'Jane Doe - Sales - gorjana | LinkedIn',
        ),
        hit(
          'https://www.linkedin.com/in/ana',
          'Ana Ruiz - Influencer Marketing Manager - Gorjana | LinkedIn',
        ),
        hit('https://www.gorjana.com/pages/about', 'About gorjana'),
      ],
      { brandName: 'gorjana', domain: 'gorjana.com', limit: 5 },
    );
    expect(selected.map((s) => s.url)).toEqual([
      'https://www.linkedin.com/in/ana',
      'https://www.linkedin.com/in/jane',
    ]);
  });
});

describe('profileBelongsToBrand', () => {
  const keys = brandMatchKeys('gorjana', 'gorjana.com');

  it('rejects a profile whose current company is another one', () => {
    expect(
      profileBelongsToBrand(
        { raw: { current_company: { name: 'Acme Inc' } } },
        keys,
      ),
    ).toBe(false);
  });

  it('accepts current company or headline naming the brand', () => {
    expect(
      profileBelongsToBrand({ raw: { current_company_name: 'Gorjana' } }, keys),
    ).toBe(true);
    expect(
      profileBelongsToBrand(
        {
          title: 'PR @ gorjana',
          raw: { current_company: { name: 'Freelance' } },
        },
        keys,
      ),
    ).toBe(true);
  });

  it('trusts the SERP pre-filter when the dataset has no company data', () => {
    expect(profileBelongsToBrand({ raw: {} }, keys)).toBe(true);
  });
});

describe('roleFromSerpTitle', () => {
  it('parses the role from a LinkedIn SERP title', () => {
    expect(
      roleFromSerpTitle(
        'Ana Ruiz - Influencer Marketing Manager - Gorjana | LinkedIn',
      ),
    ).toBe('Influencer Marketing Manager');
    expect(roleFromSerpTitle('Ana Ruiz | LinkedIn')).toBeUndefined();
  });
});

describe('pre-scrape company rejection', () => {
  it('skips profiles whose SERP title or snippet names another company', () => {
    const selected = selectLinkedInPeopleHits(
      [
        {
          url: 'https://www.linkedin.com/in/a',
          title: 'Ann Lee - Buyer - Nordstrom | LinkedIn',
          snippet: 'Worked on gorjana and other jewelry brands.',
        },
        {
          url: 'https://www.linkedin.com/in/b',
          title: 'Bea Cruz | LinkedIn',
          snippet: 'Experience: Mejuri · Former gorjana intern',
        },
        {
          url: 'https://www.linkedin.com/in/c',
          title: 'Cam Ho - PR Manager - gorjana | LinkedIn',
          snippet: 'Experience: gorjana · Education: UCLA',
        },
      ],
      { brandName: 'gorjana', domain: 'gorjana.com', limit: 5 },
    );
    expect(selected.map((s) => s.url)).toEqual([
      'https://www.linkedin.com/in/c',
    ]);
  });
});

describe('LinkedIn URL dedupe', () => {
  it('treats slugs that differ only in case/subdomain as one profile', () => {
    const selected = selectLinkedInPeopleHits(
      [
        {
          url: 'https://qa.linkedin.com/in/Daniella-magee',
          title: 'Daniella Magee - Paper Source | LinkedIn',
          snippet: '',
        },
        {
          url: 'https://tr.linkedin.com/in/daniella-magee',
          title: 'Daniella Magee - Paper Source | LinkedIn',
          snippet: '',
        },
      ],
      { brandName: 'Paper Source', domain: 'papersource.com', limit: 5 },
    );
    expect(selected.map((s) => s.url)).toEqual([
      'https://www.linkedin.com/in/daniella-magee',
    ]);
  });
});
