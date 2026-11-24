import { directFetchPage } from './direct-fetch';

const page = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  });

describe('directFetchPage', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns a real HTML page without Unlocker', async () => {
    const html = `<html><body>${'x'.repeat(2000)} partnerships@brand.com</body></html>`;
    global.fetch = jest.fn().mockResolvedValue(page(html)) as never;
    const result = await directFetchPage('https://brand.com/pages/contact', 5000);
    expect(result).toMatchObject({ ok: true, via: 'direct', bodyLength: html.length });
  });

  it('treats 404 as a definitive miss (no paid fallback)', async () => {
    global.fetch = jest.fn().mockResolvedValue(page('nope', { status: 404 })) as never;
    const result = await directFetchPage('https://brand.com/partnerships', 5000);
    expect(result).toMatchObject({ ok: false, targetStatusCode: 404, via: 'direct' });
  });

  it('falls back (null) on bot walls, 403 and tiny JS shells', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(page('blocked', { status: 403 }))
      .mockResolvedValueOnce(page(`<title>Just a moment...</title>${'y'.repeat(3000)}`))
      .mockResolvedValueOnce(page('<div id="root"></div>')) as never;
    expect(await directFetchPage('https://brand.com/a', 5000)).toBeNull();
    expect(await directFetchPage('https://brand.com/b', 5000)).toBeNull();
    expect(await directFetchPage('https://brand.com/c', 5000)).toBeNull();
  });

  it('never fetches private hosts directly', async () => {
    global.fetch = jest.fn() as never;
    expect(await directFetchPage('http://localhost:3000/x', 5000)).toBeNull();
    expect(await directFetchPage('http://10.0.0.5/x', 5000)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
