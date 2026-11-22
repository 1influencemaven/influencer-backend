export const AI_JOBS = {
  GENERATE_OUTREACH: 'generate-outreach',
  GENERATE_IDEAL_BRAND_PROFILE: 'generate-ideal-brand-profile',
} as const;

export const PROSPECTING_JOBS = {
  FIND_BRANDS: 'find-brands',
} as const;

/** Jobs for QUEUES.CONTACT_DISCOVERY (Mastra FIND_BRAND_EMAILS). */
export const CONTACT_DISCOVERY_JOBS = {
  DISCOVER_BUSINESS_CONTACTS: 'discover-business-contacts',
} as const;

/** Jobs for QUEUES.INSTAGRAM_RESEARCH (Bright Data Instagram Profiles). */
export const INSTAGRAM_RESEARCH_JOBS = {
  RESEARCH_BY_USERNAME: 'research-by-username',
  RESEARCH_BY_INFLUENCER: 'research-by-influencer',
} as const;

export const OUTREACH_JOBS = {
  SEND_EMAIL: 'send-email',
} as const;
