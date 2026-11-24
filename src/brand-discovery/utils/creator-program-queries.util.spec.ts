import {
  buildCreatorProgramQueries,
  mergeCreatorProgramHits,
} from './creator-program-queries.util';

describe('creator program queries (plan_v3 2A)', () => {
  it('builds one footprint query per distinct niche term, capped', () => {
    const queries = buildCreatorProgramQueries(['Skincare', 'skincare', 'Beauty', 'Home'], 2);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('"Skincare"');
    expect(queries[0]).toContain('"creator program"');
    expect(queries[0]).toContain('inurl:ambassador');
    expect(queries[1]).toContain('"Beauty"');
    expect(buildCreatorProgramQueries([null, '', 'ab'], 2)).toEqual([]);
    expect(buildCreatorProgramQueries(['Skincare'], 0)).toEqual([]);
  });

  it('puts program hits first and dedupes by domain', () => {
    const hit = (url: string) => ({ title: url, url, content: '' });
    const merged = mergeCreatorProgramHits(
      [hit('https://a.com'), hit('https://b.com/shop')],
      [hit('https://b.com/pages/creators'), hit('https://c.com/ambassador')],
    );
    expect(merged.hits.map((h) => h.url)).toEqual([
      'https://b.com/pages/creators',
      'https://c.com/ambassador',
      'https://a.com',
    ]);
    expect(merged.programDomains).toEqual(['b.com', 'c.com']);
  });
});
