import { directFetchHtml } from './direct-html-fetch.util';

const page = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init });

describe('directFetchHtml', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns real HTML without Unlocker', async () => {
    const html = `<html>${'x'.repeat(2000)}</html>`;
    global.fetch = jest.fn().mockResolvedValue(page(html)) as never;
    await expect(directFetchHtml('https://brand.com/about')).resolves.toMatchObject({
      outcome: 'ok',
      zone: 'direct',
      bodyLength: html.length,
    });
  });

  it('treats 404 as a definitive miss', async () => {
    global.fetch = jest.fn().mockResolvedValue(page('no', { status: 404 })) as never;
    await expect(directFetchHtml('https://brand.com/x')).resolves.toMatchObject({
      outcome: 'http_error',
      httpStatus: 404,
    });
  });

  it('falls back (null) on 403, bot walls, JS shells and private hosts', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(page('blocked', { status: 403 }))
      .mockResolvedValueOnce(page(`<title>Just a moment...</title>${'y'.repeat(3000)}`))
      .mockResolvedValueOnce(page('<div id="root"></div>')) as never;
    await expect(directFetchHtml('https://brand.com/a')).resolves.toBeNull();
    await expect(directFetchHtml('https://brand.com/b')).resolves.toBeNull();
    await expect(directFetchHtml('https://brand.com/c')).resolves.toBeNull();
    await expect(directFetchHtml('http://localhost:3000/x')).resolves.toBeNull();
  });
});
