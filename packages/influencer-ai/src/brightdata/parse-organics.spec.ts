import { parseOrganicHits, unwrapGoogleGotoLink } from './parse-organics';

describe('unwrapGoogleGotoLink', () => {
  it('rebuilds the real URL from display_link', () => {
    expect(
      unwrapGoogleGotoLink(
        'https://www.google.com/goto?url=CAESabc',
        'https://www.linkedin.com › in › jane-doe-1234',
      ),
    ).toBe('https://www.linkedin.com/in/jane-doe-1234');
  });

  it('falls back to the site root when the path is truncated', () => {
    expect(
      unwrapGoogleGotoLink(
        'https://www.google.com/goto?url=CAESabc',
        'https://www.jackpotcandles.com › pages › jackpot-cand...',
      ),
    ).toBe('https://www.jackpotcandles.com/');
  });

  it('returns null for normal links or missing display_link', () => {
    expect(
      unwrapGoogleGotoLink('https://example.com/a', 'https://example.com › a'),
    ).toBeNull();
    expect(
      unwrapGoogleGotoLink('https://www.google.com/goto?url=x', undefined),
    ).toBeNull();
  });
});

describe('parseOrganicHits — goto wrappers', () => {
  it('keeps wrapped results instead of dropping them as google.com', () => {
    const body = JSON.stringify({
      organic: [
        { link: 'https://a.example/', title: 'A', description: 'a' },
        {
          link: 'https://www.google.com/goto?url=CAESx',
          display_link: 'https://b.example › team',
          title: 'B',
          description: 'b',
        },
      ],
    });
    const hits = parseOrganicHits(body, 10);
    expect(hits.map((h) => h.url)).toEqual([
      'https://a.example/',
      'https://b.example/team',
    ]);
  });
});
