import { normalizeUrlKey } from './normalize-url-key';

describe('normalizeUrlKey (RF-04.2)', () => {
  it('treats trailing slash as same key; preserves path case', () => {
    expect(normalizeUrlKey('https://Brand.com/Contact/')).toBe(
      'https://brand.com/Contact',
    );
    expect(normalizeUrlKey('https://brand.com/Contact')).toBe(
      'https://brand.com/Contact',
    );
    expect(normalizeUrlKey('https://brand.com/contact')).not.toBe(
      normalizeUrlKey('https://brand.com/Contact'),
    );
  });

  it('does not merge distinct query strings', () => {
    expect(normalizeUrlKey('https://brand.com/p?a=1')).not.toBe(
      normalizeUrlKey('https://brand.com/p?a=2'),
    );
  });

  it('does not merge http and https', () => {
    expect(normalizeUrlKey('http://brand.com/p')).not.toBe(
      normalizeUrlKey('https://brand.com/p'),
    );
  });

  it('strips fragment only', () => {
    expect(normalizeUrlKey('https://brand.com/p#section')).toBe(
      'https://brand.com/p',
    );
  });
});
