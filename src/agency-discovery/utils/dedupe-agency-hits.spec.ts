import { dedupeAgencySerpHits } from './dedupe-agency-hits';

describe('dedupeAgencySerpHits (2C.2)', () => {
  it('dedupes by normalized domain and keeps first', () => {
    const { unique, duplicateCount } = dedupeAgencySerpHits([
      { title: 'A', url: 'https://www.Agency.Example/a', content: '1' },
      { title: 'B', url: 'https://agency.example/b', content: '2' },
      { title: 'C', url: 'https://other.example/', content: '3' },
    ]);
    expect(unique).toHaveLength(2);
    expect(unique[0].title).toBe('A');
    expect(duplicateCount).toBe(1);
  });

  it('drops invalid urls', () => {
    const { unique, droppedInvalid } = dedupeAgencySerpHits([
      { title: 'bad', url: 'not-a-url' },
      { title: 'ok', url: 'https://ok.example/' },
    ]);
    expect(unique).toHaveLength(1);
    expect(droppedInvalid).toBeGreaterThanOrEqual(1);
  });
});
