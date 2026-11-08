import {
  looksLikeHtmlDocument,
  parseGoogleSerpHtml,
  unwrapGoogleHref,
} from './parse-google-serp-html';

describe('parse-google-serp-html', () => {
  describe('unwrapGoogleHref', () => {
    it('unwraps /url?q= absolute targets', () => {
      expect(
        unwrapGoogleHref(
          '/url?q=https%3A%2F%2Fmovavi.com%2Fabout&sa=U&ved=2ahUK',
        ),
      ).toBe('https://movavi.com/about');
    });

    it('accepts direct https hrefs', () => {
      expect(unwrapGoogleHref('https://senic.com/press')).toBe(
        'https://senic.com/press',
      );
    });

    it('rejects google hosts', () => {
      expect(
        unwrapGoogleHref('/url?q=https://www.google.com/search&sa=U'),
      ).toBeNull();
      expect(unwrapGoogleHref('https://accounts.google.com/ServiceLogin')).toBeNull();
    });
  });

  describe('looksLikeHtmlDocument', () => {
    it('detects HTML markers', () => {
      expect(looksLikeHtmlDocument('<html><body><a href="x">')).toBe(true);
      expect(looksLikeHtmlDocument('{"organic":[]}')).toBe(false);
      expect(looksLikeHtmlDocument('not-json')).toBe(false);
    });
  });

  describe('parseGoogleSerpHtml', () => {
    const sampleHtml = `
      <html><body>
        <div>
          <a href="/url?q=https%3A%2F%2Fmovavi.com%2Fbrand&sa=U&ved=abc">
            <h3>Movavi Brand Partnerships</h3>
          </a>
          <a href="/url?q=https%3A%2F%2Fsenic.com%2Fabout&amp;sa=U">
            <h3>Senic — About us</h3>
          </a>
          <a href="/url?q=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dx&sa=U">
            <h3>Should be filtered</h3>
          </a>
        </div>
      </body></html>
    `;

    it('extracts organic results from anchors with h3', () => {
      const items = parseGoogleSerpHtml(sampleHtml);
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        title: 'Movavi Brand Partnerships',
        url: 'https://movavi.com/brand',
        position: 1,
        domain: 'movavi.com',
      });
      expect(items[1].url).toBe('https://senic.com/about');
      expect(items[1].position).toBe(2);
    });

    it('respects maxResults', () => {
      const items = parseGoogleSerpHtml(sampleHtml, { maxResults: 1 });
      expect(items).toHaveLength(1);
      expect(items[0].url).toBe('https://movavi.com/brand');
    });

    it('returns empty list for HTML without organics', () => {
      const html = `
        <html><body>
          <div id="search">No results found for this query.</div>
          <a href="https://www.google.com/preferences">Settings</a>
        </body></html>
      `;
      expect(parseGoogleSerpHtml(html)).toEqual([]);
    });

    it('falls back to h3 + nearby anchor pattern', () => {
      const html = `
        <html><body>
          <h3 class="LC20lb">Acme Corp</h3>
          <div><a href="https://acme.example/careers">Learn more</a></div>
        </body></html>
      `;
      const items = parseGoogleSerpHtml(html);
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Acme Corp');
      expect(items[0].url).toBe('https://acme.example/careers');
    });
  });
});
