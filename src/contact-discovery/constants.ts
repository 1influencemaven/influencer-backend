/**
 * Logical provider id for Contact Discovery BBC v1 (ADR-0020).
 * Naming: `{scope}-{vendor}` — distinct from legacy `ai+brightdata` / `brightdata`.
 */
export const BBC_BRIGHTDATA_PROVIDER_ID = 'bbc-brightdata' as const;

export type BbcBrightDataProviderId = typeof BBC_BRIGHTDATA_PROVIDER_ID;
