import {
  EMAIL_CONTACT_DATASET_IDS,
  classifyBrightDataOption,
  filterEmailContactCatalog,
  isEcommerceProductScraper,
  isEmailContactCatalogItem,
  isLinkedInPeopleScraperItem,
} from './brightdata-catalog.util';

describe('brightdata-catalog.util', () => {
  const contactsProducts = {
    id: 'gd_mpz7dobf1sbierv3gp',
    name: '1-800 Contacts Products',
    category: 'ecomm',
    domain: 'www.1800contacts.com',
    kind: 'scraper' as const,
  };

  const optiContacts = {
    id: 'gd_mq6m89jo10o05te7dk',
    name: 'OptiContacts Products',
    category: 'ecomm',
    domain: 'www.opticontacts.com',
    kind: 'scraper' as const,
  };

  const linkedInProfiles = {
    id: 'gd_l1viktl72bvl7bjuj0',
    name: 'LinkedIn people profiles',
    category: 'business',
    domain: 'linkedin.com',
    kind: 'scraper' as const,
  };

  const linkedInSearch = {
    id: 'gd_m8d03he47z8nwb5xc',
    name: 'LinkedIn people search',
    category: 'business',
    domain: 'linkedin.com',
    kind: 'scraper' as const,
  };

  it('does not classify 1-800 Contacts Products as email/contact scraper', () => {
    expect(isEcommerceProductScraper(contactsProducts)).toBe(true);
    expect(isEmailContactCatalogItem(contactsProducts)).toBe(false);
    expect(
      classifyBrightDataOption(
        contactsProducts.id,
        contactsProducts.name,
        contactsProducts,
      ),
    ).toBe('unknown');
  });

  it('does not classify OptiContacts Products as email/contact scraper', () => {
    expect(isEmailContactCatalogItem(optiContacts)).toBe(false);
    expect(isLinkedInPeopleScraperItem(optiContacts)).toBe(false);
  });

  it('classifies LinkedIn people profiles as people scraper', () => {
    expect(isLinkedInPeopleScraperItem(linkedInProfiles)).toBe(true);
    expect(isEmailContactCatalogItem(linkedInProfiles)).toBe(false);
    expect(
      classifyBrightDataOption(
        linkedInProfiles.id,
        linkedInProfiles.name,
        linkedInProfiles,
      ),
    ).toBe('people');
  });

  it('classifies LinkedIn people search as people scraper', () => {
    expect(isLinkedInPeopleScraperItem(linkedInSearch)).toBe(true);
  });

  it('keeps real contact-enriched and email-like LinkedIn scrapers', () => {
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
        domain: 'linkedin.com',
      }),
    ).toBe(true);
    expect(
      isEmailContactCatalogItem({
        id: 'gd_x',
        name: 'Business email finder',
        domain: 'linkedin.com',
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
  });

  it('e-commerce scrapers never win over LinkedIn people scrapers', () => {
    const filtered = filterEmailContactCatalog([
      contactsProducts,
      optiContacts,
      linkedInSearch,
      linkedInProfiles,
    ]);
    expect(filtered.map((i) => i.id)).toEqual([
      'gd_l1viktl72bvl7bjuj0',
      'gd_m8d03he47z8nwb5xc',
    ]);
    expect(filtered[0].id).toBe('gd_l1viktl72bvl7bjuj0');
  });

  it('does not fabricate email scrapers from Contacts substring when absent', () => {
    const filtered = filterEmailContactCatalog([
      contactsProducts,
      optiContacts,
      {
        id: 'gd_ig',
        name: 'Instagram profiles',
        kind: 'scraper',
      },
    ]);
    expect(filtered).toEqual([]);
    expect(
      filtered.some((item) => EMAIL_CONTACT_DATASET_IDS.has(item.id)),
    ).toBe(false);
  });

  it('filters a mixed catalog and falls back to LinkedIn people scrapers', () => {
    const filtered = filterEmailContactCatalog([
      {
        id: 'gd_me5ppxjr2ge6icjuh0',
        name: 'Contact enriched',
        kind: 'scraper',
        domain: 'linkedin.com',
      },
      { id: 'gd_ig', name: 'Instagram profiles', kind: 'scraper' },
      {
        id: 'gd_e',
        name: 'Work email enrichment',
        kind: 'scraper',
        domain: 'linkedin.com',
      },
    ]);
    expect(filtered.map((i) => i.id)).toEqual([
      'gd_me5ppxjr2ge6icjuh0',
      'gd_e',
    ]);

    const peopleFallback = filterEmailContactCatalog([
      linkedInProfiles,
      { id: 'gd_ig', name: 'Instagram profiles', kind: 'scraper' },
      contactsProducts,
    ]);
    expect(peopleFallback.map((i) => i.id)).toEqual(['gd_l1viktl72bvl7bjuj0']);
  });

  it('filters the real mixed catalog deterministically', () => {
    const catalog = [
      contactsProducts,
      optiContacts,
      linkedInProfiles,
      linkedInSearch,
      {
        id: 'gd_l1vikfnt1wgvvqz95w',
        name: 'LinkedIn company information',
        category: 'business',
        domain: 'linkedin.com',
        kind: 'scraper' as const,
      },
    ];
    const first = filterEmailContactCatalog(catalog).map((i) => i.id);
    const second = filterEmailContactCatalog([...catalog].reverse()).map(
      (i) => i.id,
    );
    expect(first).toEqual([
      'gd_l1viktl72bvl7bjuj0',
      'gd_m8d03he47z8nwb5xc',
    ]);
    expect(second).toEqual(first);
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
    expect(classifyBrightDataOption('gd_me5ppxjr2ge6icjuh0', 'x')).toBe(
      'contact',
    );
    expect(
      classifyBrightDataOption('gd_l1vikfnt1wgvvqz95w', 'LinkedIn company'),
    ).toBe('company');
    expect(
      classifyBrightDataOption('gd_l1viktl72bvl7bjuj0', 'LinkedIn people'),
    ).toBe('people');
  });
});
