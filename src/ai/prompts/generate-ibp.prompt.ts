/**
 * Default *business* instructions for IBP generation (Settings seed / reset / empty fallback).
 * Admins customize commercial criteria via Settings → IbpPromptTemplate.
 *
 * Mandatory HU-TM-004 evidence rules are NOT here — they live as immutable Mastra
 * system instructions in packages/influencer-ai (IBP_SYSTEM_INSTRUCTIONS).
 */
export const DEFAULT_IBP_INSTRUCTIONS = `Commercial IBP guidance (customizable):
Goal: a complete, actionable brand-fit strategy that Brand Discovery can turn into web searches. Facts about the creator must come only from the payload (never invent metrics, deals or demographics), but the commercial STRATEGY - which kinds of brands fit - is your job: propose it in full from the creator's niches, bio, audience size and country.

Use EVERY signal in the payload: each entry of manualNiches, the themes in the bio, niche and subNiche, country, language and audience size. Translate Spanish or informal niche labels into concrete English product categories (a wedding niche becomes bridal and wedding brands; a lifestyle niche becomes home, wellness or self-care categories). Do not drop a manual niche unless it is clearly not something brands sell (for example a topic about personal finance).

Field targets (aim for the range; use fewer only if the payload truly cannot support more):
- targetSectors (4-8): concrete product categories that brands sell, not vague labels. Prefer a specific category over a broad one (skincare rather than beauty alone). Cover every theme listed above, most relevant first.
- excludedSectors (3-5): sectors that clash with THIS creator's audience or are brand-safety risks for their content.
- brandSize (1-3): use startup | smb | mid_market | enterprise. Under 50k followers: startup, smb. 50k-500k: smb, mid_market. Over 500k: mid_market, enterprise (keep smb for niche or UGC-oriented creators).
- markets (1-3): the creator's country, plus another market only when language or bio support it.
- collaborationTypes (3-5): the formats that suit this creator's size and content (for instance ambassador, UGC, seeding, affiliate, paid post, launch).
- alertSignals (3-5): specific brand-fit red flags that follow from THIS creator's niche, audience and content, written in your own words. Do not reuse generic phrases and never comment on data quality or missing fields.
- desirableCriteria (4-6): concrete traits of a good partner brand for THIS creator, derived from their niche, audience, country and language; written in your own words and different from each other.
- summary (2-3 sentences, English): who the creator is commercially and exactly which brand categories fit best and why. Brand Discovery reads this, so name the categories.

Style: short English phrases, no duplicates, no generic filler. Sector and category labels stay in English even when the creator is Spanish-speaking.`;
