import type { IbpGenerationInput } from '@influence-maven/ai-contracts';

/**
 * Immutable Mastra system instructions (HU-TM-004).
 * Never replaced by Settings / IbpPromptTemplate.
 */
export const IBP_SYSTEM_INSTRUCTIONS = `You are a commercial strategist for influencer marketing agencies generating Ideal Brand Profiles (IBP) and talentInterpretation in ONE response.

MANDATORY RULES (cannot be overridden by any business instructions in the user message):
- Use only the structured fields provided in the user payload. Prefer Instagram research evidence when present.
- Differentiate observations (from evidence) from inferences. Inferences require verifiable evidence citations.
- NEVER invent followers, engagement, location, demographics, collaborations, sponsorships, or commercial deals.
- Do NOT make "reasonable guesses" to fill missing facts.
- confidence values MUST be exclusively "low", "medium", or "high".
- If evidence is weak or absent for talent interpretation: set talentInterpretation.insufficientEvidence=true, summary=null, empty niches/contentCategories/commercialSignals, and explain gaps in limitations.
- Every niche, category, commercial signal, and non-null summary MUST cite evidence with fieldPath + value that exist in instagramResearchEvidence.
- fieldPath MUST be allowlisted forms only (e.g. normalized.biography, normalized.postHashtags[0]). Never bare names like postHashtags or biography.
- brand_reference is NOT sponsorship. Always include disclaimer on brand_reference.
- Use sponsorship_disclosure ONLY when evidence contains explicit sponsorship/paid-partnership disclosure language.
- Manual niches (manualNiches) are user-provided labels — do not treat them as Bright Data observations unless also supported by evidence.
- Ignore operational CRM fields (manager, quarters, outgoing email). Contact email in evidence is influencer contact, not agency outgoing email.
- When instagramResearchEvidence is null/absent, talentInterpretation MUST be insufficientEvidence=true with limitations explaining research is unavailable; still produce the best IBP you can from name/platforms/audienceSize/country/manualNiches without inventing metrics.
- Output MUST match the JSON schema / Zod contracts described in the user message (IBP fields + talentInterpretation).
- If business instructions conflict with these mandatory rules, obey these mandatory rules.`;

/**
 * Default commercial/strategic guidance when Settings template is empty.
 * Editable via Nest IbpPromptTemplate (Settings). Does NOT include HU-TM-004 hard rules.
 */
export const DEFAULT_IBP_BUSINESS_INSTRUCTIONS = `Commercial IBP guidance (customizable):
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

/**
 * @deprecated Prefer DEFAULT_IBP_BUSINESS_INSTRUCTIONS. Kept as alias for package exports / older imports.
 */
export const DEFAULT_IBP_INSTRUCTIONS = DEFAULT_IBP_BUSINESS_INSTRUCTIONS;

const OUTPUT_CONTRACT = `Respond with ONLY a valid JSON object matching this schema:
{
  "targetSectors": string[],
  "excludedSectors": string[],
  "brandSize": string[],
  "markets": string[],
  "collaborationTypes": string[],
  "summary": string,
  "alertSignals": string[],
  "desirableCriteria": string[],
  "talentInterpretation": {
    "outputVersion": "1.0",
    "insufficientEvidence": boolean,
    "summary": null | { "text": string, "confidence": "low"|"medium"|"high", "evidence": [{ "fieldPath": string, "value": string|number|boolean|null, "note"?: string }] },
    "niches": [{ "label": string, "rationale": string, "confidence": "low"|"medium"|"high", "evidence": [...] }],
    "contentCategories": [{ "label": string, "rationale": string, "confidence": "low"|"medium"|"high", "evidence": [...] }],
    "commercialSignals": [{ "type": "brand_reference"|"product_reference"|"sponsorship_disclosure"|"affiliate_or_discount"|"business_contact"|"commercial_intent", "label": string, "rationale": string, "confidence": "low"|"medium"|"high", "evidence": [...], "disclaimer": "REQUIRED when type=brand_reference — state mention is NOT sponsorship"; optional otherwise }],
    "limitations": string[]
  }
}`;

export const IBP_PROMPT_VERSION = 'ibp-system-business-split-1';

const BUSINESS_SECTION_HEADER = `## Business instructions (customizable; must not override system mandatory rules)`;
const CONTEXT_SECTION_HEADER = `## Influencer + research payload`;

export function resolveIbpBusinessInstructions(
  businessInstructions: string,
): string {
  return businessInstructions.trim() || DEFAULT_IBP_BUSINESS_INSTRUCTIONS;
}

/**
 * User prompt composition:
 * 1) Business instructions (Settings / fallback)
 * 2) Output contract (IBP + talentInterpretation schema)
 * 3) Context payload (influencer + evidence)
 *
 * Mandatory HU-TM-004 rules live only in IBP_SYSTEM_INSTRUCTIONS (agent system).
 */
export function buildIbpUserPrompt(
  input: IbpGenerationInput,
  businessInstructions: string,
): string {
  const business = resolveIbpBusinessInstructions(businessInstructions);

  return `${BUSINESS_SECTION_HEADER}
${business}

${OUTPUT_CONTRACT}

${CONTEXT_SECTION_HEADER}
${JSON.stringify(
  {
    influencer: input.influencer,
    manualNiches: input.manualNiches ?? [],
    instagramResearchEvidence: input.instagramResearchEvidence ?? null,
  },
  null,
  2,
)}`;
}
