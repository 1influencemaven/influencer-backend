import { BrightDataToolsClient } from './client';
import { createContactResearchTools } from './tools';
import { ContactResearchToolSession } from './session';

describe('createContactResearchTools open_page (RF-04.2)', () => {
  function makeSession(maxPages = 3) {
    return new ContactResearchToolSession({
      brandName: 'Acme',
      website: 'https://acme.test',
      domain: 'acme.test',
      maxSerpQueries: 5,
      maxPages,
    });
  }

  function makeClient(openPage: jest.Mock) {
    return {
      isConfigured: () => true,
      openPage,
      searchWeb: jest.fn(),
    } as unknown as BrightDataToolsClient;
  }

  it('1-2: second open of same URL reuses HTML; one Unlocker call', async () => {
    const openPage = jest.fn().mockResolvedValue({
      ok: true,
      html: '<p>partnerships@acme.test</p>',
      targetStatusCode: 200,
    });
    const session = makeSession();
    const tools = createContactResearchTools({
      client: makeClient(openPage),
      session,
    });

    const first = await tools.open_page.execute!(
      { url: 'https://acme.test/contact' },
      {} as never,
    );
    const second = await tools.open_page.execute!(
      { url: 'https://acme.test/contact' },
      {} as never,
    );

    expect(openPage).toHaveBeenCalledTimes(1);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.textPreview).toBe(first.textPreview);
    expect(session.pageCalls).toBe(1);
    expect(session.pageOriginCounts.llmPagesAttempted).toBe(1);
    expect(session.pageOriginCounts.llmPagesDownloaded).toBe(1);
    expect(session.pageOriginCounts.llmPagesReused).toBe(1);
    expect(session.pageOriginCounts.duplicateUrlSkips).toBe(1);
  });

  it('3: trailing-slash variant reuses without second download', async () => {
    const openPage = jest.fn().mockResolvedValue({
      ok: true,
      html: '<html>ok</html>',
      targetStatusCode: 200,
    });
    const session = makeSession();
    const tools = createContactResearchTools({
      client: makeClient(openPage),
      session,
    });

    await tools.open_page.execute!(
      { url: 'https://acme.test/Contact' },
      {} as never,
    );
    await tools.open_page.execute!(
      { url: 'https://acme.test/Contact/' },
      {} as never,
    );

    expect(openPage).toHaveBeenCalledTimes(1);
    expect(session.pageOriginCounts.llmPagesReused).toBe(1);
  });

  it('4: distinct query params are not merged', async () => {
    const openPage = jest.fn().mockResolvedValue({
      ok: true,
      html: '<html>ok</html>',
      targetStatusCode: 200,
    });
    const session = makeSession(5);
    const tools = createContactResearchTools({
      client: makeClient(openPage),
      session,
    });

    await tools.open_page.execute!(
      { url: 'https://acme.test/p?a=1' },
      {} as never,
    );
    await tools.open_page.execute!(
      { url: 'https://acme.test/p?a=2' },
      {} as never,
    );

    expect(openPage).toHaveBeenCalledTimes(2);
    expect(session.pageCalls).toBe(2);
  });

  it('5: path case differences are not assumed equivalent', async () => {
    const openPage = jest.fn().mockResolvedValue({
      ok: true,
      html: '<html>ok</html>',
      targetStatusCode: 200,
    });
    const session = makeSession(5);
    const tools = createContactResearchTools({
      client: makeClient(openPage),
      session,
    });

    await tools.open_page.execute!(
      { url: 'https://acme.test/About' },
      {} as never,
    );
    await tools.open_page.execute!(
      { url: 'https://acme.test/about' },
      {} as never,
    );

    expect(openPage).toHaveBeenCalledTimes(2);
  });

  it('6: http and https are not merged', async () => {
    const openPage = jest.fn().mockResolvedValue({
      ok: true,
      html: '<html>ok</html>',
      targetStatusCode: 200,
    });
    const session = makeSession(5);
    const tools = createContactResearchTools({
      client: makeClient(openPage),
      session,
    });

    await tools.open_page.execute!(
      { url: 'http://acme.test/p' },
      {} as never,
    );
    await tools.open_page.execute!(
      { url: 'https://acme.test/p' },
      {} as never,
    );

    expect(openPage).toHaveBeenCalledTimes(2);
  });

  it('7-8: prior failure allows retry; failure does not store usable HTML', async () => {
    const openPage = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        html: undefined,
        targetStatusCode: 500,
        brdError: 'fail',
      })
      .mockResolvedValueOnce({
        ok: true,
        html: '<p>ok</p>',
        targetStatusCode: 200,
      });
    const session = makeSession(5);
    const tools = createContactResearchTools({
      client: makeClient(openPage),
      session,
    });

    const fail = await tools.open_page.execute!(
      { url: 'https://acme.test/x' },
      {} as never,
    );
    expect(fail.ok).toBe(false);
    expect(session.hasUsablePageHtml('https://acme.test/x')).toBe(false);

    const ok = await tools.open_page.execute!(
      { url: 'https://acme.test/x' },
      {} as never,
    );
    expect(ok.ok).toBe(true);
    expect(openPage).toHaveBeenCalledTimes(2);
    expect(session.pageOriginCounts.llmPagesAttempted).toBe(2);
    expect(session.pageOriginCounts.llmPagesDownloaded).toBe(1);
  });

  it('9: allowlist reject does not count as download', async () => {
    const openPage = jest.fn();
    const session = makeSession();
    const tools = createContactResearchTools({
      client: makeClient(openPage),
      session,
    });

    const result = await tools.open_page.execute!(
      { url: 'https://evil.test/x' },
      {} as never,
    );

    expect(result.ok).toBe(false);
    expect(openPage).not.toHaveBeenCalled();
    expect(session.pageOriginCounts.llmPagesAttempted).toBe(0);
    expect(session.pageOriginCounts.llmPagesDownloaded).toBe(0);
  });

  it('10: cache hit does not consume page budget', async () => {
    const openPage = jest.fn().mockResolvedValue({
      ok: true,
      html: '<html>ok</html>',
      targetStatusCode: 200,
    });
    const session = makeSession(1);
    const tools = createContactResearchTools({
      client: makeClient(openPage),
      session,
    });

    await tools.open_page.execute!(
      { url: 'https://acme.test/a' },
      {} as never,
    );
    const reused = await tools.open_page.execute!(
      { url: 'https://acme.test/a' },
      {} as never,
    );
    const other = await tools.open_page.execute!(
      { url: 'https://acme.test/b' },
      {} as never,
    );

    expect(reused.ok).toBe(true);
    expect(session.pageCalls).toBe(1);
    expect(other.ok).toBe(false);
    expect(String(other.error)).toMatch(/budget exhausted/i);
    expect(openPage).toHaveBeenCalledTimes(1);
  });

  it('12: extract_emails works on reused HTML with same attribution', async () => {
    const openPage = jest.fn().mockResolvedValue({
      ok: true,
      html: '<a href="mailto:press@acme.test">press@acme.test</a>',
      targetStatusCode: 200,
    });
    const session = makeSession();
    const tools = createContactResearchTools({
      client: makeClient(openPage),
      session,
    });

    await tools.open_page.execute!(
      { url: 'https://acme.test/press' },
      {} as never,
    );
    await tools.open_page.execute!(
      { url: 'https://acme.test/press/' },
      {} as never,
    );

    const extracted = await tools.extract_emails.execute!(
      { url: 'https://acme.test/press/' },
      {} as never,
    );

    expect(extracted.ok).toBe(true);
    expect(extracted.emails).toContain('press@acme.test');
    expect(session.listEmails()[0]?.sourceUrl).toBe(
      'https://acme.test/press/',
    );
  });
});
