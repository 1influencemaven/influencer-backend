import {
  isValidNormalizedInstagramHandle,
  normalizeInstagramHandle,
} from './normalize-instagram';

describe('normalizeInstagramHandle', () => {
  it('strips @ and lowercases', () => {
    expect(normalizeInstagramHandle('@LauraFit_ES')).toBe('laurafit_es');
  });

  it('extracts handle from profile URL', () => {
    expect(
      normalizeInstagramHandle('https://www.instagram.com/LauraFit_ES/'),
    ).toBe('laurafit_es');
  });

  it('strips query and hash from URL', () => {
    expect(
      normalizeInstagramHandle('https://instagram.com/foo.bar?hl=es#section'),
    ).toBe('foo.bar');
  });

  it('trims whitespace', () => {
    expect(normalizeInstagramHandle('  @demo_user  ')).toBe('demo_user');
  });
});

describe('isValidNormalizedInstagramHandle', () => {
  it('accepts valid handles', () => {
    expect(isValidNormalizedInstagramHandle('laurafit_es')).toBe(true);
    expect(isValidNormalizedInstagramHandle('a.b_1')).toBe(true);
  });

  it('rejects empty or invalid characters', () => {
    expect(isValidNormalizedInstagramHandle('')).toBe(false);
    expect(isValidNormalizedInstagramHandle('bad handle')).toBe(false);
    expect(isValidNormalizedInstagramHandle('has/slash')).toBe(false);
  });
});
