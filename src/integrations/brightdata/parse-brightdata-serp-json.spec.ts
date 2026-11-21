import { parseBrightDataSerpJson } from './parse-brightdata-serp-json';

describe('parseBrightDataSerpJson', () => {
  it('parses organic array from brd_json payload', () => {
    const body = JSON.stringify({
      general: { query: 'pizza' },
      organic: [
        {
          title: 'Pizza Hut',
          link: 'https://www.pizzahut.com/',
          description: 'Order pizza',
          rank: 1,
        },
      ],
    });

    const result = parseBrightDataSerpJson(body);
    expect(result.kind).toBe('brd_json');
    if (result.kind !== 'brd_json') return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: 'Pizza Hut',
      url: 'https://www.pizzahut.com/',
      domain: 'pizzahut.com',
      snippet: 'Order pizza',
      position: 1,
    });
  });

  it('returns empty items when organic is empty array', () => {
    const result = parseBrightDataSerpJson(JSON.stringify({ organic: [] }));
    expect(result).toEqual({ kind: 'brd_json', items: [] });
  });

  it('returns not_brd_json for HTML', () => {
    const result = parseBrightDataSerpJson('<html><body>hi</body></html>');
    expect(result.kind).toBe('not_brd_json');
  });

  it('reads organic from wrapped format=json body object', () => {
    const result = parseBrightDataSerpJson(
      JSON.stringify({
        status_code: 200,
        headers: {},
        body: {
          organic: [
            { title: 'A', link: 'https://a.example/', rank: 1 },
          ],
        },
      }),
    );
    expect(result.kind).toBe('brd_json');
    if (result.kind !== 'brd_json') return;
    expect(result.items[0].url).toBe('https://a.example/');
  });
});
