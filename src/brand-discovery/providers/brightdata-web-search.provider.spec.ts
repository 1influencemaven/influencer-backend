import { BrightDataWebSearchProvider } from './brightdata-web-search.provider';
import type { BrightDataSearchClient } from '../../lead-discovery/clients/brightdata-search.client';
import type { SearchResult } from '../../lead-discovery/interfaces/lead-search.interface';

describe('BrightDataWebSearchProvider', () => {
  const search = jest.fn();
  const client = { search } as unknown as BrightDataSearchClient;
  const provider = new BrightDataWebSearchProvider(client);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function result(items: SearchResult['items']): SearchResult {
    return {
      items,
      meta: {
        provider: 'brightdata',
        attempt: 1,
        httpStatus: 200,
        responseBytes: 1,
        elapsedMs: 1,
        emptyBody: false,
        query: 'q',
      },
    };
  }

  it('implements WebSearchProvider name', () => {
    expect(provider.name).toBe('brightdata');
  });

  it('maps Bright Data items to WebSearchHit', async () => {
    search.mockResolvedValue(
      result([
        {
          title: 'Movavi',
          url: 'https://movavi.com',
          snippet: 'Video software',
          position: 1,
          domain: 'movavi.com',
        },
      ]),
    );

    const hits = await provider.search('movavi brands');

    expect(search).toHaveBeenCalledWith({
      text: 'movavi brands',
      num: 6,
    });
    expect(hits).toEqual([
      {
        title: 'Movavi',
        url: 'https://movavi.com',
        content: 'Video software',
      },
    ]);
  });

  it('passes maxResults as num', async () => {
    search.mockResolvedValue(result([]));
    await provider.search('q', { maxResults: 10 });
    expect(search).toHaveBeenCalledWith({ text: 'q', num: 10 });
  });

  it('drops items without url and fills empty title', async () => {
    search.mockResolvedValue(
      result([
        {
          title: '',
          url: '',
          snippet: 'x',
          position: 1,
          domain: '',
        },
        {
          title: '',
          url: 'https://senic.com/about',
          snippet: 'Audio',
          position: 2,
          domain: 'senic.com',
        },
      ]),
    );

    const hits = await provider.search('q');
    expect(hits).toEqual([
      {
        title: 'senic.com',
        url: 'https://senic.com/about',
        content: 'Audio',
      },
    ]);
  });
});
