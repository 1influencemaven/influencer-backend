import {
  classifySerpHtmlWithoutOrganics,
  looksLikeGoogleConsentPage,
  looksLikeGoogleSerpStructure,
  looksLikeSerpSoftBlock,
} from './classify-serp-html';

describe('classify-serp-html (AI-004.5.1.1)', () => {
  /** Synthetic fixtures — not live serp_api captures. */
  const organicEmptyHtml = `
    <html><body>
      <div id="result-stats">About 0 results</div>
      <div id="search"><div id="rso">No results found for this query.</div></div>
    </body></html>
  `;

  const consentHtml = `
    <html><body>
      <form action="https://consent.google.com/save">
        <h1>Before you continue to Google</h1>
        <p>We use cookies</p>
        <button id="L2AGLb">Accept all</button>
      </form>
    </body></html>
  `;

  const softBlockHtml = `
    <html><body>
      <div>Our systems have detected unusual traffic from your computer network.</div>
      <a href="https://www.google.com/sorry/index">continue</a>
      <div class="g-recaptcha"></div>
    </body></html>
  `;

  const unknownHtml = `
    <html><body>
      <div class="wrapper"><p>Hello world landing page</p></div>
    </body></html>
  `;

  it('detects consent page', () => {
    expect(looksLikeGoogleConsentPage(consentHtml)).toBe(true);
    expect(classifySerpHtmlWithoutOrganics(consentHtml)).toBe('consent_page');
  });

  it('detects soft block / captcha', () => {
    expect(looksLikeSerpSoftBlock(softBlockHtml)).toBe(true);
    expect(classifySerpHtmlWithoutOrganics(softBlockHtml)).toBe('soft_block');
  });

  it('detects SERP structure → organic_empty', () => {
    expect(looksLikeGoogleSerpStructure(organicEmptyHtml)).toBe(true);
    expect(classifySerpHtmlWithoutOrganics(organicEmptyHtml)).toBe(
      'organic_empty',
    );
  });

  it('falls back to unknown_html when no strong signals', () => {
    expect(looksLikeGoogleConsentPage(unknownHtml)).toBe(false);
    expect(looksLikeSerpSoftBlock(unknownHtml)).toBe(false);
    expect(looksLikeGoogleSerpStructure(unknownHtml)).toBe(false);
    expect(classifySerpHtmlWithoutOrganics(unknownHtml)).toBe('unknown_html');
  });

  it('does not treat random cookie mention alone as consent', () => {
    const weak = '<html><body><p>We love cookie recipes</p></body></html>';
    expect(looksLikeGoogleConsentPage(weak)).toBe(false);
    expect(classifySerpHtmlWithoutOrganics(weak)).toBe('unknown_html');
  });
});
