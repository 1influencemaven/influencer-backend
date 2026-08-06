import {
  EMAIL_CONTACT_DATASET_IDS,
  classifyBrightDataOption,
  filterEmailContactCatalog,
  isEmailContactCatalogItem,
} from './brightdata-catalog.util';

describe('brightdata-catalog.util', () => {
  it('keeps contact-enriched and email-like names', () => {
    expect(
      isEmailContactCatalogItem({
        id: 'gd_me5ppxjr2ge6icjuh0',
        name: 'Anything',
      }),
    ).toBe(true);
    expect(
      isEmailContactCatalogItem({
        id: 'gd_other',
        name: 'LinkedIn people contact-enriched',
      }),
    ).toBe(true);
    expect(
      isEmailContactCatalogItem({
        id: 'gd_x',
        name: 'Business email finder',
      }),
    ).toBe(true);
  });

  it('drops unrelated scrapers', () => {
    expect(
      isEmailContactCatalogItem({
        id: 'gd_fb',
        name: 'Facebook posts',
      }),
    ).toBe(false);
    expect(
      isEmailContactCatalogItem({
        id: 'gd_l1vikfnt1wgvvqz95w',
        name: 'LinkedIn company information',
      }),
    ).toBe(false);
    expect(
      isEmailContactCatalogItem({
        id: 'gd_l1viktl72bvl7bjuj0',
        name: 'LinkedIn people profiles',
      }),
    ).toBe(false);
  });

  it('filters a mixed catalog and falls back to LinkedIn people scrapers', () => {
    const filtered = filterEmailContactCatalog([
      { id: 'gd_me5ppxjr2ge6icjuh0', name: 'Contact enriched', kind: 'scraper' },
      { id: 'gd_ig', name: 'Instagram profiles', kind: 'scraper' },
      { id: 'gd_e', name: 'Work email enrichment', kind: 'scraper' },
    ]);
    expect(filtered.map((i) => i.id)).toEqual([
      'gd_me5ppxjr2ge6icjuh0',
      'gd_e',
    ]);

    const peopleFallback = filterEmailContactCatalog([
      {
        id: 'gd_l1viktl72bvl7bjuj0',
        name: 'LinkedIn people profiles',
        kind: 'scraper',
      },
      { id: 'gd_ig', name: 'Instagram profiles', kind: 'scraper' },
    ]);
    expect(peopleFallback.map((i) => i.id)).toEqual(['gd_l1viktl72bvl7bjuj0']);
  });

  it('does not treat marketplace-only company datasets as email options', () => {
    expect(
      isEmailContactCatalogItem({
        id: 'gd_mhofmgsw2zktogh14',
        name: 'Some marketplace dump',
      }),
    ).toBe(false);
  });

  it('classifies option kinds', () => {
    expect(
      classifyBrightDataOption('gd_me5ppxjr2ge6icjuh0', 'x'),
    ).toBe('contact');
    expect(
      classifyBrightDataOption('gd_l1vikfnt1wgvvqz95w', 'LinkedIn company'),
    ).toBe('company');
    expect(
      classifyBrightDataOption('gd_l1viktl72bvl7bjuj0', 'LinkedIn people'),
    ).toBe('people');
  });
});
