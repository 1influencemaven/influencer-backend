import { normalizeNameToSlug, slugSimilarityScore } from './slug-match.util';

describe('slug-match.util', () => {
  it('normalizes names to slug', () => {
    expect(normalizeNameToSlug('Mariano Said')).toBe('mariano-said');
  });

  it('scores exact slug match', () => {
    expect(slugSimilarityScore('mariano-said', 'mariano-said')).toBe(1);
  });
});
