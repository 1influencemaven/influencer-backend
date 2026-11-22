/**
 * BullMQ worker options for INSTAGRAM_RESEARCH.
 *
 * Budget mirrors Bright Data dataset scrape poll window + headroom:
 * - BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS default = 120_000
 * - trigger / progress HTTP ceilings use BRIGHTDATA_SEARCH_TIMEOUT_MS (60_000)
 * - persist / logging headroom
 */

/** Default Bright Data snapshot poll wall (env BRIGHTDATA_SCRAPER_POLL_TIMEOUT_MS). */
export const INSTAGRAM_RESEARCH_BUDGET_POLL_MS = 120_000;

/** Nest persist / logging headroom (not a product operation timeout). */
export const INSTAGRAM_RESEARCH_LOCK_HEADROOM_MS = 60_000;

/**
 * lockDuration for `@Processor(INSTAGRAM_RESEARCH)`.
 * BullMQ renews locks automatically when lockRenewTime > 0 (default lockDuration / 2).
 */
export const INSTAGRAM_RESEARCH_LOCK_DURATION_MS =
  INSTAGRAM_RESEARCH_BUDGET_POLL_MS + INSTAGRAM_RESEARCH_LOCK_HEADROOM_MS;
