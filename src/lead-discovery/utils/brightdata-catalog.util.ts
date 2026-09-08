import type { BrightDataCatalogItem } from '../clients/brightdata.client';

/** Known Bright Data IDs used for contact/email enrichment (collectable scrapers). */
export const EMAIL_CONTACT_DATASET_IDS = new Set([
  'gd_me5ppxjr2ge6icjuh0', // LinkedIn people contact-enriched
]);

/** Collectable LinkedIn people scrapers (profiles / people search). */
export const LINKEDIN_PEOPLE_SCRAPER_IDS = new Set([
  'gd_l1viktl72bvl7bjuj0', // LinkedIn people profiles
  'gd_m8d03he47z8nwb5xc', // LinkedIn people search
]);

/**
 * Strong email/contact signals only. Bare "Contacts" in a brand/product name
 * is NOT enough (false positive: "1-800 Contacts Products").
 */
const EMAIL_INCLUDE =
  /people\s*contact|contact[-\s]?enrich|business\s*contact|e-?mails?|email|enrich(?:ment|ed)?|revenue\s*base/i;

const PEOPLE_INCLUDE =
  /linkedin.*people|people.*profiles?|people\s*search|people profiles/i;

const EMAIL_EXCLUDE =
  /facebook|instagram|tiktok|twitter|x\.com|youtube|amazon|ebay|reddit|pinterest|shopify|woocommerce|google\s*maps|serp|unlocker|browser/i;

const PRODUCT_EXCLUDE =
  /\bproducts?\b|\bpdp\b|product\s*detail|collect_by_url.*product|variant|sku\b/i;

export type BrightDataOptionKind = 'people' | 'company' | 'contact' | 'unknown';

export type BrightDataCatalogClassifyInput = {
  id: string;
  name: string;
  category?: string;
  domain?: string;
  scraperTypes?: string[];
};

function haystackOf(item: BrightDataCatalogClassifyInput): string {
  return `${item.id} ${item.name} ${item.category ?? ''} ${item.domain ?? ''} ${(item.scraperTypes ?? []).join(' ')}`;
}

/** E-commerce / product collection scrapers must never enter Lead Discovery allowlist. */
export function isEcommerceProductScraper(
  item: BrightDataCatalogClassifyInput,
): boolean {
  const category = (item.category ?? '').toLowerCase();
  if (category === 'ecomm' || category === 'ecommerce' || category === 'e-commerce') {
    return true;
  }

  const domain = (item.domain ?? '').toLowerCase();
  if (
    domain &&
    !domain.includes('linkedin.com') &&
    PRODUCT_EXCLUDE.test(`${item.name} ${domain}`)
  ) {
    return true;
  }

  const name = item.name.toLowerCase();
  if (PRODUCT_EXCLUDE.test(name) && !PEOPLE_INCLUDE.test(name)) {
    // Brand names like "1-800 Contacts Products" / "OptiContacts Products"
    if (/contacts?\s+products?/i.test(item.name) || /\bproducts?\b/i.test(item.name)) {
      return true;
    }
  }

  return false;
}

function isLinkedInDomain(item: BrightDataCatalogClassifyInput): boolean {
  const domain = (item.domain ?? '').toLowerCase();
  return !domain || domain.includes('linkedin.com');
}

export function classifyBrightDataOption(
  id: string,
  name: string,
  meta?: Pick<
    BrightDataCatalogClassifyInput,
    'category' | 'domain' | 'scraperTypes'
  >,
): BrightDataOptionKind {
  const item: BrightDataCatalogClassifyInput = {
    id,
    name,
    category: meta?.category,
    domain: meta?.domain,
    scraperTypes: meta?.scraperTypes,
  };

  if (isEcommerceProductScraper(item)) {
    return 'unknown';
  }

  if (EMAIL_CONTACT_DATASET_IDS.has(id) || isEmailContactCatalogItem(item)) {
    return 'contact';
  }
  if (
    /linkedin.*company|company.*linkedin|company information/i.test(
      `${id} ${name}`,
    )
  ) {
    return 'company';
  }
  if (isLinkedInPeopleScraperItem(item)) {
    return 'people';
  }
  return 'unknown';
}

/**
 * Keep only scrapers likely to yield professional emails / enriched contacts.
 * Call this on `/datasets/v3/scrapers` results only (not Marketplace list).
 */
export function isEmailContactCatalogItem(
  item: BrightDataCatalogClassifyInput,
): boolean {
  if (isEcommerceProductScraper(item)) {
    return false;
  }
  if (EMAIL_CONTACT_DATASET_IDS.has(item.id)) {
    return true;
  }

  const haystack = haystackOf(item);
  if (EMAIL_EXCLUDE.test(haystack)) {
    return false;
  }
  if (!EMAIL_INCLUDE.test(haystack)) {
    return false;
  }
  // Email enrichment for Lead Discovery must target LinkedIn (or omit domain).
  return isLinkedInDomain(item);
}

export function isLinkedInPeopleScraperItem(
  item: BrightDataCatalogClassifyInput,
): boolean {
  if (isEcommerceProductScraper(item)) {
    return false;
  }
  if (LINKEDIN_PEOPLE_SCRAPER_IDS.has(item.id)) {
    return true;
  }
  const haystack = haystackOf(item);
  if (EMAIL_EXCLUDE.test(haystack)) {
    return false;
  }
  if (!PEOPLE_INCLUDE.test(haystack)) {
    return false;
  }
  return isLinkedInDomain(item);
}

function peopleScraperRank(item: BrightDataCatalogItem): number {
  // Prefer profile scrapers over people-search.
  if (item.id === 'gd_l1viktl72bvl7bjuj0') {
    return 0;
  }
  if (/people\s*profiles?/i.test(item.name)) {
    return 1;
  }
  if (item.id === 'gd_m8d03he47z8nwb5xc' || /people\s*search/i.test(item.name)) {
    return 2;
  }
  return 3;
}

/**
 * Prefer real email/contact scrapers; if none exist on the account, fall back to
 * LinkedIn people scrapers (profiles first, then people search).
 * Never returns e-commerce product scrapers.
 */
export function filterEmailContactCatalog(
  items: BrightDataCatalogItem[],
): BrightDataCatalogItem[] {
  const emailItems = items.filter(isEmailContactCatalogItem);
  if (emailItems.length > 0) {
    return emailItems;
  }

  return items
    .filter(isLinkedInPeopleScraperItem)
    .slice()
    .sort((a, b) => peopleScraperRank(a) - peopleScraperRank(b));
}
