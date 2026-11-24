import type { BrightDataToolsClient } from '../brightdata/client';
import {
  buildLinkedInPeopleQueries,
  fetchZoomInfoLeaders,
  findLeaderLinkedInHit,
  isClearlyUselessRole,
  isUsefulRole,
} from './people-sources';

describe('isUsefulRole / isClearlyUselessRole', () => {
  it.each([
    'Social Media & Influencer Marketing Manager',
    'Head of Marketing',
    'Director of Brand Partnerships',
    'PR & Communications Lead',
    'Founder',
  ])('keeps %s', (role) => expect(isUsefulRole(role)).toBe(true));

  it.each([
    'Assistant Store Manager',
    'Software Engineer',
    'Customer Service Representative',
  ])('drops %s', (role) => {
    expect(isUsefulRole(role)).toBe(false);
    expect(isClearlyUselessRole(role)).toBe(true);
  });

  it('does not pre-reject an ambiguous "Name - Company" segment', () => {
    expect(isClearlyUselessRole('Demo Co')).toBe(false);
  });
});

describe('buildLinkedInPeopleQueries', () => {
  it('covers several role groups per query, custom roles first', () => {
    const queries = buildLinkedInPeopleQueries({
      brandName: 'Paper Source',
      priorityRoles: ['Brand Director'],
      maxQueries: 3,
    });
    expect(queries).toEqual([
      'site:linkedin.com/in "Paper Source" ("Brand Director")',
      'site:linkedin.com/in "Paper Source" (influencer OR creator OR partnerships OR affiliate OR ambassador)',
      'site:linkedin.com/in "Paper Source" (PR OR "public relations" OR communications OR "social media")',
    ]);
  });
});

describe('ZoomInfo leaders', () => {
  const client = (rows: Record<string, unknown>[], organics: unknown[] = []) =>
    ({
      filterDatasetRows: jest.fn().mockResolvedValue({ ok: true, rows }),
      searchWeb: jest.fn().mockResolvedValue({ ok: true, organics }),
    }) as unknown as BrightDataToolsClient;

  it('keeps useful leadership roles of the exact website only', async () => {
    const { leaders } = await fetchZoomInfoLeaders(
      client([
        {
          website: 'https://www.finepapersource.com/',
          leadership: [{ name: 'X Y', title: 'CMO' }],
        },
        {
          website: 'https://www.papersource.com/',
          leadership: [
            { name: 'Tim Callaghan', title: ' Head of Marketing ' },
            { name: 'Pat Doe', title: 'VP Finance' },
          ],
        },
      ]),
      'papersource.com',
    );
    expect(leaders).toEqual([
      { name: 'Tim Callaghan', title: 'Head of Marketing' },
    ]);
  });

  it('never throws when the dataset call fails', async () => {
    const failing = {
      filterDatasetRows: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as BrightDataToolsClient;
    await expect(
      fetchZoomInfoLeaders(failing, 'papersource.com'),
    ).resolves.toEqual({
      leaders: [],
      error: 'boom',
    });
  });

  it('resolves a leader LinkedIn profile whose title has the last name', async () => {
    const hit = await findLeaderLinkedInHit(
      client(
        [],
        [
          {
            title: 'Paper Source | LinkedIn',
            url: 'https://www.linkedin.com/company/paper-source',
            snippet: '',
          },
          {
            title:
              'Tim Callaghan - Head of Marketing - Paper Source | LinkedIn',
            url: 'https://www.linkedin.com/in/timcallaghan',
            snippet: '',
          },
        ],
      ),
      { name: 'Tim Callaghan', title: 'Head of Marketing' },
      'Paper Source',
    );
    expect(hit?.url).toBe('https://www.linkedin.com/in/timcallaghan');
  });
});
