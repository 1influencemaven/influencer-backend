import type { BrightDataCatalogItem } from '../clients/brightdata.client';

/** Known Bright Data IDs used for contact/email enrichment (collectable scrapers). */
export const EMAIL_CONTACT_DATASET_IDS = new Set([
  'gd_me5ppxjr2ge6icjuh0', // LinkedIn people contact-enriched
]);

/** Collectable LinkedIn people scrapers (profiles; usually no email). Fallback for free tier. */
export const LINKEDIN_PEOPLE_SCRAPER_IDS = new Set([
  'gd_l1viktl72bvl7bjuj0',
]);

const EMAIL_INCLUDE =
  /contact|email|e-?mail|enrich|revenue\s*base|business\s*contact|people\s*contact/i;

const PEOPLE_INCLUDE = /linkedin.*people|people.*profile|people profiles/i;

const EMAIL_EXCLUDE =
  /facebook|instagram|tiktok|twitter|x\.com|youtube|amazon|ebay|reddit|pinterest|shopify|woocommerce|google\s*maps|serp|unlocker|browser/i;

export type BrightDataOptionKind = 'people' | 'company' | 'contact' | 'unknown';

export function classifyBrightDataOption(
  id: string,
  name: string,
): BrightDataOptionKind {
  const haystack = `${id} ${name}`.toLowerCase();

  if (
    EMAIL_CONTACT_DATASET_IDS.has(id) ||
    /contact|email|enrich|revenue/.test(haystack)
  ) {
    return 'contact';
  }
  if (/linkedin.*company|company.*linkedin|company information/.test(haystack)) {
    return 'company';
  }
  if (
    LINKEDIN_PEOPLE_SCRAPER_IDS.has(id) ||
    /linkedin.*people|people.*profile|people profiles/.test(haystack)
  ) {
    return 'people';
  }
  return 'unknown';
}

/**
 * Keep only scrapers likely to yield professional emails / enriched contacts.
 * Call this on `/datasets/v3/scrapers` results only (not Marketplace list).
 */
export function isEmailContactCatalogItem(item: {
  id: string;
  name: string;
}): boolean {
  if (EMAIL_CONTACT_DATASET_IDS.has(item.id)) {
    return true;
  }

  const haystack = `${item.id} ${item.name}`;
  if (EMAIL_EXCLUDE.test(haystack)) {
    return false;
  }
  return EMAIL_INCLUDE.test(haystack);
}

export function isLinkedInPeopleScraperItem(item: {
  id: string;
  name: string;
}): boolean {
  if (LINKEDIN_PEOPLE_SCRAPER_IDS.has(item.id)) {
    return true;
  }
  const haystack = `${item.id} ${item.name}`;
  if (EMAIL_EXCLUDE.test(haystack)) {
    return false;
  }
  return PEOPLE_INCLUDE.test(haystack);
}

/**
 * Prefer email/contact scrapers; if none exist on the account, fall back to
 * LinkedIn people scrapers (collectable on free Scrapers credits).
 */
export function filterEmailContactCatalog(
  items: BrightDataCatalogItem[],
): BrightDataCatalogItem[] {
  const emailItems = items.filter(isEmailContactCatalogItem);
  if (emailItems.length > 0) {
    return emailItems;
  }
  return items.filter(isLinkedInPeopleScraperItem);
}
