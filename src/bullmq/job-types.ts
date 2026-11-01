export const AI_JOBS = {
  GENERATE_OUTREACH: 'generate-outreach',
  GENERATE_IDEAL_BRAND_PROFILE: 'generate-ideal-brand-profile',
} as const;

export const PROSPECTING_JOBS = {
  FIND_BRANDS: 'find-brands',
  FIND_LEADS: 'find-leads',
} as const;

/** Jobs for QUEUES.CONTACT_DISCOVERY (BBC v1 allowlist HTML; Search not wired). */
export const CONTACT_DISCOVERY_JOBS = {
  DISCOVER_BUSINESS_CONTACTS: 'discover-business-contacts',
} as const;

export const OUTREACH_JOBS = {
  SEND_EMAIL: 'send-email',
} as const;
