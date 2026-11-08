/**
 * Historical BBC Nest allowlist provider id (kept for metadata/UI recognition).
 * Write path is Mastra (`MASTRA_CONTACT_EMAILS_PROVIDER_ID`).
 */
export const BBC_BRIGHTDATA_PROVIDER_ID = 'bbc-brightdata' as const;

export type BbcBrightDataProviderId = typeof BBC_BRIGHTDATA_PROVIDER_ID;

/**
 * Mastra FIND_BRAND_EMAILS (2A) via ai.execution.requests — product write path.
 */
export const MASTRA_CONTACT_EMAILS_PROVIDER_ID = 'mastra-contact-emails' as const;

export type MastraContactEmailsProviderId =
  typeof MASTRA_CONTACT_EMAILS_PROVIDER_ID;

/** Default max Unlocker/open_page pages for a BBC/Mastra contact run. */
export const BBC_V1_DEFAULT_MAX_PAGES = 12;
