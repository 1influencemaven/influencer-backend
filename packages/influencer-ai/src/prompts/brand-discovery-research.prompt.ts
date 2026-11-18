import type {
  BrandPageSnapshot,
  IbpCriteriaSnapshot,
} from '@influence-maven/ai-contracts';

/**
 * Fixed operational constraints for RESEARCH_BRAND (not Settings-editable).
 */
const RESEARCH_OPERATION_CONSTRAINTS = `Operation: RESEARCH_BRAND

You receive page text snapshots prepared by NestJS (Web Unlocker). You do NOT browse the web or invent URLs.

Fixed rules:
- Extract company, industry, offerings, markets, and commercial signals ONLY from the provided snapshots
- Each researched field MUST include status: VERIFIED | PARTIAL | NOT_FOUND | UNAVAILABLE
- VERIFIED: concrete evidence in snapshots + evidence[].url must be one of the provided snapshot URLs
- PARTIAL: weak/incomplete indications; still cite snapshot URLs when possible
- NOT_FOUND: you looked in the provided pages and found nothing — value MUST be null; this does NOT mean the brand lacks the feature
- UNAVAILABLE: cannot evaluate (empty/useless content) — value MUST be null
- Never invent companies, programs, URLs, excerpts, or evidence
- evidence excerpts must be short substrings grounded in the provided textContent (or omit excerpt)
- commercialSignals MUST be structured objects with kind, value, status, evidence, optional note — not free text
- For commercialSignals: value=true only with VERIFIED/PARTIAL evidence; value=null for NOT_FOUND/UNAVAILABLE; do NOT set value=false merely because nothing was found
- influencerFit.score is OPTIONAL (integer 0–100). Omit score unless you can justify it from IBP + page evidence
- If you emit score, rationale must be non-empty and status VERIFIED or PARTIAL
- pages[] should reflect the pages Nest already listed (roles/urls); do not invent extra pages
- researchStatus (agent-level ONLY): COMPLETED | PARTIAL | FAILED — NEVER use VERIFIED/NOT_FOUND/UNAVAILABLE here (those are field-level status values only)
- identity.name MUST be an object { value, status, evidence, note? } — NEVER a bare string
- Optional keys (note, errorMessage, score, warnings, alignmentNotes): OMIT the key when unused — do NOT emit null
- Prefer fewer strong VERIFIED claims over padded guesses
- Do not emit Prisma evidenceStatus / VERIFIED at candidate level — Nest owns that enum separately
- Do not invent placeholder brands (e.g. "Example Company"); research ONLY the Brand to research below`;

const OUTPUT_CONTRACT = `Respond with ONLY valid JSON matching this schema (no markdown fence):
{
  "researchStatus": "COMPLETED" | "PARTIAL" | "FAILED",
  "identity": {
    "name": { "value": string|null, "status": "VERIFIED"|"PARTIAL"|"NOT_FOUND"|"UNAVAILABLE", "evidence": [{"url":"...","excerpt?":"..."}] },
    "officialWebsite": { "value": string|null, "status": "...", "evidence": [...] },
    "domain": { "value": string|null, "status": "...", "evidence": [...] }
  },
  "company": { "description": {...}, "brandSize": {...} },
  "industry": { "sectors": {...}, "categories": {...} },
  "offerings": { "productsAndServices": {...} },
  "markets": { "countriesOrRegions": {...} },
  "commercialSignals": [
    {
      "kind": "influencer_marketing"|"affiliate"|"creator_program"|"ambassador"|"partnerships"|"sponsorship"|"ugc",
      "value": true|false|null,
      "status": "VERIFIED"|"PARTIAL"|"NOT_FOUND"|"UNAVAILABLE",
      "evidence": [{"url":"...","excerpt?":"..."}]
    }
  ],
  "influencerFit": {
    "score?": 0-100,
    "rationale": {...},
    "alignmentNotes?": {...}
  },
  "pages": [
    { "url": "...", "role": "homepage"|"about"|"products"|"partnerships"|"other", "fetchStatus": "ok"|"http_error"|"empty_body"|"timeout"|"network_error"|"skipped"|"rejected", "httpStatus?": number }
  ],
  "warnings?": ["..."]
}

Do not include an "operation" field. Omit optional keys instead of null.`;

export type BrandDiscoveryResearchPromptInput = {
  influencerName: string;
  niche?: string | null;
  subNiche?: string | null;
  country?: string | null;
  language?: string | null;
  followers?: number | null;
  engagement?: number | null;
  ibp: IbpCriteriaSnapshot;
  brand: { name: string; website: string; domain: string };
  pageSnapshots: BrandPageSnapshot[];
  maxPages: number;
  businessInstructions: string;
  /** Nest-known page fetch outcomes (optional hint for pages[]). */
  pageFetchHints?: Array<{
    url: string;
    role: BrandPageSnapshot['role'];
    fetchStatus: string;
    httpStatus?: number;
    errorMessage?: string;
  }>;
};

export function buildBrandDiscoveryResearchUserPrompt(
  input: BrandDiscoveryResearchPromptInput,
): string {
  const business = input.businessInstructions.trim();
  const profileLines = [
    `Name: ${input.influencerName}`,
    `Niche: ${input.niche?.trim() || 'n/a'}`,
    `Sub-niche: ${input.subNiche?.trim() || 'n/a'}`,
    `Country: ${input.country?.trim() || 'n/a'}`,
    `Language: ${input.language?.trim() || 'n/a'}`,
    `Followers: ${input.followers ?? 'n/a'}`,
    `Engagement %: ${input.engagement ?? 'n/a'}`,
  ].join('\n');

  const snapshotsJson = JSON.stringify(input.pageSnapshots, null, 2);
  const hintsJson = input.pageFetchHints
    ? JSON.stringify(input.pageFetchHints, null, 2)
    : '[]';

  return `${business ? `${business}\n\n` : ''}${RESEARCH_OPERATION_CONSTRAINTS}

${OUTPUT_CONTRACT}

Brand to research:
${JSON.stringify(input.brand, null, 2)}
maxPages: ${input.maxPages}

Influencer profile:
${profileLines}

Ideal Brand Profile:
${JSON.stringify(input.ibp, null, 2)}

Page snapshots from Nest (only source of evidence):
${snapshotsJson}

Page fetch hints from Nest (for pages[] alignment):
${hintsJson}`;
}

export function buildBrandDiscoveryResearchCorrectionPrompt(params: {
  previousRaw: string;
  errorMessage: string;
}): string {
  return `Your previous response was invalid JSON for brand deep research.

Error: ${params.errorMessage}

Previous response:
${params.previousRaw}

Fix and return ONLY valid JSON for RESEARCH_BRAND:
- researchStatus must be COMPLETED|PARTIAL|FAILED (not VERIFIED)
- identity.name must be {value,status,evidence} object (not a string)
- omit optional note/errorMessage keys instead of null
- no operation field, no invented URLs, no placeholder brands`;
}
