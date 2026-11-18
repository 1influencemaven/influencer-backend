/** Stable keys for InfluencerFieldProvenance.fieldKey */
export const INFLUENCER_FIELD_KEYS = {
  NAME: 'name',
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  COUNTRY: 'country',
  LANGUAGE: 'language',
  NICHE: 'niche',
  SUB_NICHE: 'subNiche',
  NICHES: 'niches',
  FOLLOWERS: 'followers',
  ENGAGEMENT: 'engagement',
  EMAIL: 'email',
  OUTGOING_EMAIL: 'outgoingEmail',
  MEDIA_KIT_URL: 'mediaKitUrl',
  MANAGER_ID: 'managerId',
} as const;

export type InfluencerFieldKey =
  (typeof INFLUENCER_FIELD_KEYS)[keyof typeof INFLUENCER_FIELD_KEYS];
