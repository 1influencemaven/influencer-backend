import {
  assertBrandResearchUrl,
  extractCanonicalOrFinalUrlHint,
  isAuthorizedBrandHost,
} from './brand-research-url-guard.util';

describe('brand-research-url-guard', () => {
  it('allows brand domain and subdomains', () => {
    expect(isAuthorizedBrandHost('demo.example', 'demo.example')).toBe(true);
    expect(isAuthorizedBrandHost('shop.demo.example', 'demo.example')).toBe(
      true,
    );
    expect(isAuthorizedBrandHost('www.demo.example', 'demo.example')).toBe(
      true,
    );
  });

  it('rejects off-domain lookalikes', () => {
    expect(isAuthorizedBrandHost('demo.example.evil.com', 'demo.example')).toBe(
      false,
    );
    expect(assertBrandResearchUrl('https://evil.com/', 'demo.example').ok).toBe(
      false,
    );
  });

  it('blocks SSRF targets', () => {
    expect(
      assertBrandResearchUrl('http://127.0.0.1/', 'demo.example').ok,
    ).toBe(false);
    expect(
      assertBrandResearchUrl('http://169.254.169.254/', 'demo.example').ok,
    ).toBe(false);
    expect(
      assertBrandResearchUrl('http://localhost/', 'demo.example').ok,
    ).toBe(false);
  });

  it('accepts https brand homepage', () => {
    const r = assertBrandResearchUrl(
      'https://www.demo.example/about',
      'demo.example',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hostname).toContain('demo.example');
    }
  });

  it('extracts canonical URL hint', () => {
    const html =
      '<html><link rel="canonical" href="https://demo.example/about" /></html>';
    expect(extractCanonicalOrFinalUrlHint(html)).toBe(
      'https://demo.example/about',
    );
  });
});
