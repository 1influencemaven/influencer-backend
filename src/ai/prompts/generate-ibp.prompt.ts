/**
 * Default *business* instructions for IBP generation (Settings seed / reset / empty fallback).
 * Admins customize commercial criteria via Settings → IbpPromptTemplate.
 *
 * Mandatory HU-TM-004 evidence rules are NOT here — they live as immutable Mastra
 * system instructions in packages/influencer-ai (IBP_SYSTEM_INSTRUCTIONS).
 */
export const DEFAULT_IBP_INSTRUCTIONS = `Commercial IBP guidance (customizable):
- Prioritize targetSectors that match the creator's demonstrated themes and audience.
- Populate excludedSectors for clear brand-safety or audience mismatches.
- brandSize: use startup | smb | mid_market | enterprise when justified by audience/scale signals in the payload.
- markets: geographic markets only when supported by provided location/language/evidence — otherwise keep conservative or empty.
- collaborationTypes: e.g. product launch, brand ambassador, UGC.
- summary: 1-2 sentences about the ideal brand fit (IBP summary — distinct from talentInterpretation.summary).
- alertSignals / desirableCriteria: brand-fit red flags and nice-to-haves.
- Focus on commercial fit criteria; do not invent profile facts.`;
